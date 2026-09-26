-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('BASE', 'VECTOR', 'VELOCITY', 'QUANTUM');

-- CreateEnum
CREATE TYPE "FeatureVisibility" AS ENUM ('PUBLIC', 'LOGIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('MOTOR', 'PUMP', 'MOTOR_PUMP', 'RESERVOIR', 'WTP', 'OHT', 'DMA', 'PIPELINE', 'FLOW_METER', 'PRESSURE_SENSOR', 'WATER_LEVEL', 'CHLORINATOR', 'WQ_ANALYSER');

-- CreateEnum
CREATE TYPE "Transport" AS ENUM ('MQTT', 'LORAWAN', 'WIFI', 'SIM', 'RTU_MODBUS', 'HTTP');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('RUNNING', 'STOPPED', 'FAULT');

-- CreateEnum
CREATE TYPE "SiteKind" AS ENUM ('DMA', 'PUMP_STATION', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WATCH', 'ALARM', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'READ', 'ACKNOWLEDGED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AttachmentOwner" AS ENUM ('REPORT', 'FIELD_VERIFICATION', 'MESSAGE');

-- CreateEnum
CREATE TYPE "IntegrationSystem" AS ENUM ('SUJALAM_BHARAT', 'JJM_1_0');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('NOT_MAPPED', 'IN_PROGRESS', 'VALIDATION_PENDING', 'READY_FOR_SYNC', 'SYNCED', 'SYNC_FAILED', 'CONFLICT', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PUSH', 'PULL');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "Tier" NOT NULL DEFAULT 'VECTOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "FeatureVisibility" NOT NULL DEFAULT 'LOGIN',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "reportsToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "roleId" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SiteKind" NOT NULL DEFAULT 'OTHER',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "code" TEXT,
    "district" TEXT,
    "block" TEXT,
    "zone" TEXT,
    "scheme" TEXT,
    "phType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL DEFAULT 'MOTOR_PUMP',
    "siteId" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "ratedPowerKw" DECIMAL(10,2),
    "ratedVoltageV" DECIMAL(10,2),
    "ratedCurrentA" DECIMAL(10,2),
    "ratedSpeedRpm" INTEGER,
    "ratedFlowM3h" DECIMAL(10,2),
    "ratedHeadM" DECIMAL(10,2),
    "status" "AssetStatus" NOT NULL DEFAULT 'RUNNING',
    "installedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "voltageV" DECIMAL(10,2),
    "currentA" DECIMAL(10,2),
    "powerFactor" DECIMAL(5,3),
    "inputPowerKw" DECIMAL(10,3),
    "efficiencyPct" DECIMAL(5,2),
    "voltageUnbalancePct" DECIMAL(5,2),
    "currentUnbalancePct" DECIMAL(5,2),
    "thdVoltagePct" DECIMAL(5,2),
    "thdCurrentPct" DECIMAL(5,2),
    "loadPct" DECIMAL(5,2),
    "speedRpm" INTEGER,
    "vibrationMmS" DECIMAL(6,2),
    "windingTempC" DECIMAL(6,2),
    "bearingTempC" DECIMAL(6,2),
    "statorIndex" DECIMAL(5,1),
    "rotorIndex" DECIMAL(5,1),
    "bearingIndex" DECIMAL(5,1),
    "eccentricityIndex" DECIMAL(5,1),
    "supplyIndex" DECIMAL(5,1),
    "loadIndex" DECIMAL(5,1),
    "flowM3h" DECIMAL(10,2),
    "headM" DECIMAL(10,2),
    "specificEnergyKwhM3" DECIMAL(8,3),
    "healthScore" DECIMAL(5,1),
    "source" TEXT NOT NULL DEFAULT 'demo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "metric" TEXT,
    "valueNum" DECIMAL(12,3),
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connectivity" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "transport" "Transport" NOT NULL DEFAULT 'HTTP',
    "config" JSONB NOT NULL DEFAULT '{}',
    "gatewayId" TEXT,
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connectivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "quality" TEXT,
    "source" TEXT NOT NULL DEFAULT 'api',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "parentId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "assetTag" TEXT,
    "area" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "ownerType" "AttachmentOwner" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exifTakenAt" TIMESTAMP(3),
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "watermarked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Personnel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT,
    "area" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterQualitySample" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "sampleTime" TIMESTAMP(3) NOT NULL,
    "ph" DECIMAL(4,2),
    "turbidityNtu" DECIMAL(6,2),
    "chlorineMgl" DECIMAL(5,2),
    "tdsMgl" DECIMAL(7,1),
    "ecoli" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Safe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaterQualitySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSummary" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "connections" INTEGER NOT NULL DEFAULT 0,
    "billedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "collectedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "arrearsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accountability" (
    "id" TEXT NOT NULL,
    "officer" TEXT NOT NULL,
    "area" TEXT,
    "kpi" TEXT NOT NULL,
    "target" DECIMAL(12,2),
    "actual" DECIMAL(12,2),
    "unit" TEXT,
    "period" TEXT,
    "status" TEXT NOT NULL DEFAULT 'On track',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Accountability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "period" TEXT,
    "summary" TEXT,
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Valve" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "district" TEXT,
    "block" TEXT,
    "zone" TEXT,
    "valveType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "positionPct" DECIMAL(5,1),
    "controllable" BOOLEAN NOT NULL DEFAULT false,
    "upstreamBar" DECIMAL(6,2),
    "downstreamBar" DECIMAL(6,2),
    "flowKlmin" DECIMAL(8,2),
    "health" TEXT,
    "lastOperated" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Valve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValveOp" (
    "id" TEXT NOT NULL,
    "valveId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "positionPct" DECIMAL(5,1),
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValveOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "assetTag" TEXT,
    "title" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'Preventive',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "assignedTo" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NrwRecord" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "inputKl" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "billedKl" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "nrwPct" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NrwRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PREVENTIVE',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "siteId" TEXT,
    "siteName" TEXT,
    "assetTag" TEXT,
    "district" TEXT,
    "block" TEXT,
    "zone" TEXT,
    "assignee" TEXT,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRecord" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "siteName" TEXT,
    "district" TEXT,
    "block" TEXT,
    "zone" TEXT,
    "period" TEXT NOT NULL,
    "connections" INTEGER NOT NULL DEFAULT 0,
    "demandInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "collectedInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "arrearsInr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "billedKl" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IlkDetection" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "area" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'Illegal connection',
    "severity" TEXT NOT NULL DEFAULT 'Medium',
    "estLossKl" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'Detected',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "detectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IlkDetection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkSegment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "diameterMm" INTEGER,
    "lengthM" DECIMAL(10,1),
    "flowM3h" DECIMAL(10,2),
    "pressureBar" DECIMAL(6,2),
    "status" TEXT NOT NULL DEFAULT 'Normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVerification" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "location" TEXT,
    "category" TEXT,
    "verifier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisLayer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "geojson" JSONB NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IntegrationProvider" (
    "id" TEXT NOT NULL,
    "system" "IntegrationSystem" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mockMode" BOOLEAN NOT NULL DEFAULT true,
    "supportsPush" BOOLEAN NOT NULL DEFAULT false,
    "supportsPull" BOOLEAN NOT NULL DEFAULT false,
    "autoSync" BOOLEAN NOT NULL DEFAULT false,
    "gisValidation" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT,
    "authType" TEXT,
    "schemaVersion" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMapping" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalEntityId" TEXT NOT NULL,
    "externalSystem" "IntegrationSystem" NOT NULL,
    "externalEntityType" TEXT NOT NULL,
    "externalEntityId" TEXT,
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'NOT_MAPPED',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "mappedBy" TEXT,
    "mappedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT,
    "externalVersion" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemeProfile" (
    "id" TEXT NOT NULL,
    "schemeKey" TEXT NOT NULL,
    "swatiSchemeId" TEXT NOT NULL,
    "sujalamBharatId" TEXT,
    "schemeName" TEXT NOT NULL,
    "schemeType" TEXT,
    "state" TEXT NOT NULL DEFAULT 'West Bengal',
    "district" TEXT,
    "block" TEXT,
    "gramPanchayat" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'NOT_MAPPED',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "lastSyncedAt" TIMESTAMP(3),
    "externalVersion" TEXT,
    "demo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchemeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" TEXT NOT NULL,
    "serviceAreaId" TEXT NOT NULL,
    "schemeProfileId" TEXT NOT NULL,
    "sujalamBharatId" TEXT,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'West Bengal',
    "district" TEXT,
    "block" TEXT,
    "gramPanchayat" TEXT,
    "population" INTEGER,
    "households" INTEGER,
    "fhtc" INTEGER,
    "targetHouseholds" INTEGER,
    "supplySource" TEXT,
    "supplyMode" TEXT,
    "supplyDurationHrs" DECIMAL(4,1),
    "supplyFrequency" TEXT,
    "waterQualityStatus" TEXT,
    "serviceStatus" TEXT,
    "gisBoundary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SujalGaon" (
    "id" TEXT NOT NULL,
    "sujalGaonId" TEXT,
    "swatiVillageId" TEXT NOT NULL,
    "serviceAreaId" TEXT,
    "schemeProfileId" TEXT,
    "sujalamBharatId" TEXT,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'West Bengal',
    "district" TEXT,
    "block" TEXT,
    "gramPanchayat" TEXT,
    "population" INTEGER,
    "households" INTEGER,
    "fhtc" INTEGER,
    "supplyStatus" TEXT,
    "supplyDurationHrs" DECIMAL(4,1),
    "waterQualityStatus" TEXT,
    "gisBoundary" JSONB,
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'NOT_MAPPED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SujalGaon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfrastructureMapping" (
    "id" TEXT NOT NULL,
    "infrastructureId" TEXT NOT NULL,
    "assetId" TEXT,
    "assetTag" TEXT,
    "category" TEXT NOT NULL,
    "schemeProfileId" TEXT,
    "serviceAreaId" TEXT,
    "sujalamBharatId" TEXT,
    "externalInfraId" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'NOT_MAPPED',
    "demo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfrastructureMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationSystem" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "entityType" TEXT,
    "state" "SyncState" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "success" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "mock" BOOLEAN NOT NULL DEFAULT true,
    "triggeredBy" TEXT,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalEntityId" TEXT,
    "externalEntityId" TEXT,
    "direction" "SyncDirection" NOT NULL,
    "state" "SyncState" NOT NULL DEFAULT 'PENDING',
    "payloadVersion" TEXT,
    "response" JSONB,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovAuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT,
    "role" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "externalSystem" "IntegrationSystem",
    "syncJobId" TEXT,
    "ip" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyImport" (
    "id" TEXT NOT NULL,
    "source" "IntegrationSystem" NOT NULL DEFAULT 'JJM_1_0',
    "batchLabel" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'asset',
    "state" "SyncState" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "linked" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LegacyImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldMapping" (
    "id" TEXT NOT NULL,
    "externalSystem" "IntegrationSystem" NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalField" TEXT NOT NULL,
    "externalField" TEXT NOT NULL,
    "transform" TEXT NOT NULL DEFAULT 'DIRECT',
    "transformArg" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "demo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleMapping" (
    "id" TEXT NOT NULL,
    "swatiRole" TEXT NOT NULL,
    "externalRole" TEXT NOT NULL,
    "externalSystem" "IntegrationSystem" NOT NULL DEFAULT 'SUJALAM_BHARAT',
    "canPush" BOOLEAN NOT NULL DEFAULT false,
    "canPull" BOOLEAN NOT NULL DEFAULT false,
    "canResolve" BOOLEAN NOT NULL DEFAULT false,
    "canImport" BOOLEAN NOT NULL DEFAULT false,
    "geoScope" TEXT NOT NULL DEFAULT 'ALL',
    "demo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRule" (
    "id" TEXT NOT NULL,
    "externalSystem" "IntegrationSystem",
    "entityType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "param" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "message" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "demo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_deploymentId_key_key" ON "FeatureFlag"("deploymentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");

-- CreateIndex
CREATE INDEX "Site_district_block_idx" ON "Site"("district", "block");

-- CreateIndex
CREATE INDEX "Site_kind_idx" ON "Site"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tag_key" ON "Asset"("tag");

-- CreateIndex
CREATE INDEX "Reading_assetId_ts_idx" ON "Reading"("assetId", "ts");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Connectivity_assetId_key" ON "Connectivity"("assetId");

-- CreateIndex
CREATE INDEX "Measurement_assetId_ts_idx" ON "Measurement"("assetId", "ts");

-- CreateIndex
CREATE INDEX "Measurement_assetId_metric_ts_idx" ON "Measurement"("assetId", "metric", "ts");

-- CreateIndex
CREATE INDEX "Message_toId_status_idx" ON "Message"("toId", "status");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Valve_tag_key" ON "Valve"("tag");

-- CreateIndex
CREATE INDEX "ValveOp_valveId_ts_idx" ON "ValveOp"("valveId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_code_key" ON "WorkOrder"("code");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_district_block_idx" ON "WorkOrder"("district", "block");

-- CreateIndex
CREATE INDEX "BillingRecord_period_idx" ON "BillingRecord"("period");

-- CreateIndex
CREATE INDEX "BillingRecord_district_block_idx" ON "BillingRecord"("district", "block");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProvider_system_key" ON "IntegrationProvider"("system");

-- CreateIndex
CREATE INDEX "EntityMapping_internalEntityId_idx" ON "EntityMapping"("internalEntityId");

-- CreateIndex
CREATE INDEX "EntityMapping_externalEntityId_idx" ON "EntityMapping"("externalEntityId");

-- CreateIndex
CREATE INDEX "EntityMapping_externalSystem_entityType_idx" ON "EntityMapping"("externalSystem", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeProfile_schemeKey_key" ON "SchemeProfile"("schemeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeProfile_swatiSchemeId_key" ON "SchemeProfile"("swatiSchemeId");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeProfile_sujalamBharatId_key" ON "SchemeProfile"("sujalamBharatId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_serviceAreaId_key" ON "ServiceArea"("serviceAreaId");

-- CreateIndex
CREATE INDEX "ServiceArea_schemeProfileId_idx" ON "ServiceArea"("schemeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "SujalGaon_sujalGaonId_key" ON "SujalGaon"("sujalGaonId");

-- CreateIndex
CREATE UNIQUE INDEX "SujalGaon_swatiVillageId_key" ON "SujalGaon"("swatiVillageId");

-- CreateIndex
CREATE INDEX "SujalGaon_serviceAreaId_idx" ON "SujalGaon"("serviceAreaId");

-- CreateIndex
CREATE INDEX "SujalGaon_schemeProfileId_idx" ON "SujalGaon"("schemeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "InfrastructureMapping_infrastructureId_key" ON "InfrastructureMapping"("infrastructureId");

-- CreateIndex
CREATE INDEX "InfrastructureMapping_assetId_idx" ON "InfrastructureMapping"("assetId");

-- CreateIndex
CREATE INDEX "InfrastructureMapping_schemeProfileId_idx" ON "InfrastructureMapping"("schemeProfileId");

-- CreateIndex
CREATE INDEX "SyncJob_provider_startedAt_idx" ON "SyncJob"("provider", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRecord_syncJobId_idx" ON "SyncRecord"("syncJobId");

-- CreateIndex
CREATE INDEX "GovAuditLog_entityType_ts_idx" ON "GovAuditLog"("entityType", "ts");

-- CreateIndex
CREATE INDEX "FieldMapping_externalSystem_entityType_idx" ON "FieldMapping"("externalSystem", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "FieldMapping_externalSystem_entityType_internalField_key" ON "FieldMapping"("externalSystem", "entityType", "internalField");

-- CreateIndex
CREATE UNIQUE INDEX "RoleMapping_swatiRole_key" ON "RoleMapping"("swatiRole");

-- CreateIndex
CREATE INDEX "ValidationRule_entityType_idx" ON "ValidationRule"("entityType");

-- CreateIndex
CREATE INDEX "ValidationRule_externalSystem_entityType_idx" ON "ValidationRule"("externalSystem", "entityType");

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connectivity" ADD CONSTRAINT "Connectivity_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValveOp" ADD CONSTRAINT "ValveOp_valveId_fkey" FOREIGN KEY ("valveId") REFERENCES "Valve"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_schemeProfileId_fkey" FOREIGN KEY ("schemeProfileId") REFERENCES "SchemeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SujalGaon" ADD CONSTRAINT "SujalGaon_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SujalGaon" ADD CONSTRAINT "SujalGaon_schemeProfileId_fkey" FOREIGN KEY ("schemeProfileId") REFERENCES "SchemeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRecord" ADD CONSTRAINT "SyncRecord_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

