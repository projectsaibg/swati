/**
 * Field Verification — feature: field_verification (BASE, LOGIN).
 *
 * Evidence-grade field photos. On upload the server:
 *  - stamps an authoritative server timestamp (uploadedAt) — the trusted time,
 *  - reads EXIF DateTimeOriginal + GPS from the image (supporting, may be spoofed),
 *  - burns a watermark (SWATI, server time, GPS, ref) onto a copy,
 *  - stores BOTH the untouched original and the watermarked copy in MinIO,
 *  - records a FieldVerification + an Attachment (server time + EXIF/GPS).
 *
 *   POST /api/field-verification               (data.enter) multipart: photo + fields
 *   GET  /api/field-verification               list verifications + photo metadata
 *   GET  /api/field-verification/:attId/image  stream the watermarked evidence photo
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleInit,
  Param, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as Minio from 'minio';
import * as exifr from 'exifr';
import Jimp from 'jimp';
import { PrismaService } from './prisma.service';
import { CurrentUser, Feature, Perm } from './decorators';

function makeClient() {
  const url = new URL(process.env.S3_ENDPOINT || 'http://minio:9000');
  return new Minio.Client({
    endPoint: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    useSSL: url.protocol === 'https:',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
  });
}
const BUCKET = process.env.S3_BUCKET || 'swati-evidence';

@Injectable()
export class FieldVerificationService implements OnModuleInit {
  private readonly s3 = makeClient();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const exists = await this.s3.bucketExists(BUCKET).catch(() => false);
      if (!exists) await this.s3.makeBucket(BUCKET, '');
    } catch {
      /* storage may be booting; upload will surface a clear error if unavailable */
    }
  }

  private async watermark(buf: Buffer, lines: string[]): Promise<Buffer> {
    const img = await Jimp.read(buf);
    if (img.bitmap.width > 1600) img.resize(1600, Jimp.AUTO);
    const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
    const barH = 22 * lines.length + 12;
    const bar = new Jimp(img.bitmap.width, barH, 0x000000aa);
    img.composite(bar, 0, img.bitmap.height - barH);
    lines.forEach((l, i) => img.print(font, 10, img.bitmap.height - barH + 6 + i * 22, l));
    return img.getBufferAsync(Jimp.MIME_JPEG);
  }

  async create(user: any, file: Express.Multer.File, body: any) {
    if (!file) throw new BadRequestException('A photo file is required');
    const ref = String(body?.ref || '').trim();
    if (!ref) throw new BadRequestException('ref is required');

    const serverTs = new Date(); // authoritative
    const gps = await exifr.gps(file.buffer).catch(() => null);
    const meta = await exifr.parse(file.buffer, ['DateTimeOriginal']).catch(() => null);
    const lat = gps?.latitude ?? null;
    const lng = gps?.longitude ?? null;
    const exifTakenAt = meta?.DateTimeOriginal ? new Date(meta.DateTimeOriginal) : null;

    const fv = await this.prisma.fieldVerification.create({
      data: {
        ref, location: body.location || null, category: body.category || null,
        verifier: user.name, notes: body.notes || null,
        latitude: lat, longitude: lng, verifiedAt: serverTs, status: 'Verified',
      },
    });

    const base = `field-verification/${fv.id}/${Date.now()}`;
    const origKey = `${base}.orig.jpg`;
    const wmKey = `${base}.jpg`;
    const wmBuf = await this.watermark(file.buffer, [
      `SWATI EVIDENCE  ${serverTs.toISOString()}`,
      `Ref ${ref}${lat != null ? `  GPS ${lat.toFixed(5)}, ${lng!.toFixed(5)}` : '  GPS: none'}  by ${user.name}`,
    ]);
    try {
      await this.s3.putObject(BUCKET, origKey, file.buffer, file.buffer.length, { 'Content-Type': file.mimetype });
      await this.s3.putObject(BUCKET, wmKey, wmBuf, wmBuf.length, { 'Content-Type': 'image/jpeg' });
    } catch (e: any) {
      throw new BadRequestException(`Storage upload failed: ${e?.message ?? 'unknown'}`);
    }

    const att = await this.prisma.attachment.create({
      data: {
        ownerType: 'FIELD_VERIFICATION', ownerId: fv.id, storageKey: wmKey,
        uploaderId: user.id, uploadedAt: serverTs, exifTakenAt,
        gpsLat: lat, gpsLng: lng, watermarked: true,
      },
    });
    return { fieldVerification: fv, attachmentId: att.id };
  }

  async list() {
    const fvs = await this.prisma.fieldVerification.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const atts = await this.prisma.attachment.findMany({
      where: { ownerType: 'FIELD_VERIFICATION', ownerId: { in: fvs.map((f) => f.id) } },
    });
    const byFv = new Map<string, typeof atts>();
    for (const a of atts) {
      const arr = byFv.get(a.ownerId) ?? [];
      arr.push(a); byFv.set(a.ownerId, arr);
    }
    return fvs.map((f) => ({
      id: f.id, ref: f.ref, location: f.location, category: f.category, verifier: f.verifier,
      status: f.status, notes: f.notes, latitude: f.latitude, longitude: f.longitude,
      verifiedAt: f.verifiedAt, createdAt: f.createdAt,
      photos: (byFv.get(f.id) ?? []).map((a) => ({
        attachmentId: a.id, uploadedAt: a.uploadedAt, exifTakenAt: a.exifTakenAt,
        gpsLat: a.gpsLat, gpsLng: a.gpsLng, watermarked: a.watermarked,
      })),
    }));
  }

  async stream(attId: string, res: Response) {
    const att = await this.prisma.attachment.findUnique({ where: { id: attId } });
    if (!att) throw new NotFoundException('Photo not found');
    const obj = await this.s3.getObject(BUCKET, att.storageKey).catch(() => null);
    if (!obj) throw new NotFoundException('Photo object missing');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    obj.pipe(res);
  }
}

@Controller('field-verification')
export class FieldVerificationController {
  constructor(private readonly svc: FieldVerificationService) {}

  @Feature('field_verification') @Get()
  list() { return this.svc.list(); }

  @Feature('field_verification') @Perm('data.enter')
  @Post() @UseInterceptors(FileInterceptor('photo'))
  create(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File, @Body() body: any) {
    return this.svc.create(user, file, body);
  }

  @Feature('field_verification') @Get(':attId/image')
  image(@Param('attId') attId: string, @Res() res: Response) {
    return this.svc.stream(attId, res);
  }
}

@Module({
  providers: [FieldVerificationService],
  controllers: [FieldVerificationController],
  exports: [FieldVerificationService],
})
export class FieldVerificationModule {}
