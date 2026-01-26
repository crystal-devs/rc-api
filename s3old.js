import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client();
const BUCKET = "rc-media-bucket";
const BACKEND_URL = "https://pride-function-gulf-valve.trycloudflare.com/api/v1/media/update-photo";
const BACKEND_TOKEN = process.env.BACKEND_TOKEN;

export const handler = async (event) => {
    console.log("Event:", JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        console.log("Processing key:", key);

        if (!key.includes("/original/")) {
            console.log("Skipping non-original:", key);
            continue;
        }

        // Extract uploadId early
        const uploadId = key.match(/\/original\/([^\/.]+)\./)?.[1];
        if (!uploadId) {
            console.error("Could not extract uploadId from:", key);
            continue; // Skip instead of throw
        }

        let variantKeys = {};
        try {
            // 1. Download
            console.log("Downloading from S3:", key);
            const { Body, ContentLength } = await s3.send(
                new GetObjectCommand({ Bucket: BUCKET, Key: key })
            );

            if (ContentLength > 50 * 1024 * 1024) {
                throw new Error("Image too large (>50MB)");
            }

            const chunks = [];
            for await (const chunk of Body) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            console.log("Downloaded:", buffer.length, "bytes");

            // 2. Generate variants
            const sizes = { small: 300, med: 1080, large: 1920 };

            for (const [size, width] of Object.entries(sizes)) {
                console.log(`Generating ${size} variant...`);
                const variantBuffer = await sharp(buffer)
                    .resize(width, null, { withoutEnlargement: true })
                    .webp({ quality: 80, effort: 4 })
                    .toBuffer();

                const variantKey = key
                    .replace("/original/", `/variants/${size}/`)
                    .replace(/\.[^/.]+$/, ".webp");

                await s3.send(
                    new PutObjectCommand({
                        Bucket: BUCKET,
                        Key: variantKey,
                        Body: variantBuffer,
                        ContentType: "image/webp",
                        CacheControl: "public, max-age=31536000",
                    })
                );

                variantKeys[size] = variantKey;
                console.log(`Uploaded: ${variantKey}`);
            }

            // 3. Notify backend
            console.log("Calling backend:", BACKEND_URL);
            console.log("Payload:", { uploadId, variants: variantKeys });

            if (!BACKEND_TOKEN) {
                throw new Error("BACKEND_TOKEN is missing in Lambda env");
            }

            const response = await fetch(BACKEND_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${BACKEND_TOKEN}`,
                },
                body: JSON.stringify({
                    uploadId,
                    variants: {
                        small: variantKeys.small,
                        medium: variantKeys.med,
                        large: variantKeys.large,
                    }
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                console.error("Backend failed:", response.status, text);
                throw new Error(`Backend error: ${response.status} - ${text}`);
            }

            console.log("Backend updated successfully");
        } catch (err) {
            console.error("Processing failed for:", key, "uploadId:", uploadId, err);

            // Cleanup partial variants
            if (Object.keys(variantKeys).length > 0) {
                console.log("Cleaning up partial variants...");
                await Promise.allSettled(
                    Object.values(variantKeys).map(k =>
                        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })).catch(() => { })
                    )
                );
            }

            throw err; // Let Lambda retry
        }
    }

    return { statusCode: 200 };
};


// cloudflared tunnel --url http://localhost:3001