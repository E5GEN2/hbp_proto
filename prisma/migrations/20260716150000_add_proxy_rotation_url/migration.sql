-- Optional real rotation endpoint for a proxy (register-proxy form / import field 9)
ALTER TABLE "proxies" ADD COLUMN "rotationUrl" TEXT;
