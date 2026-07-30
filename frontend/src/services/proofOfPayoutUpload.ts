export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);

export interface ValidatedProofFile {
  file: Blob;
  type: string;
  hash: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  return null;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return bytesToHex(new Uint8Array(hash));
}

async function stripImageMetadata(file: Blob, type: string): Promise<Blob> {
  if (!type.startsWith('image/') || typeof document === 'undefined' || typeof Image === 'undefined') {
    return file;
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Invalid image content'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to sanitize proof image');
    ctx.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Unable to sanitize proof image'));
        else resolve(blob);
      }, type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function validateProofFile(file: Blob): Promise<ValidatedProofFile> {
  if (file.size > PROOF_MAX_BYTES) {
    throw new Error('Proof file must be 10MB or smaller');
  }

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sniffedType = sniffMime(header);
  if (!sniffedType || !ALLOWED_TYPES.has(sniffedType)) {
    throw new Error('Only PNG, JPEG, and PDF proof files are allowed');
  }

  if (file.type && file.type !== sniffedType) {
    throw new Error('Proof file content does not match its declared type');
  }

  const sanitized = await stripImageMetadata(file, sniffedType);
  return {
    file: sanitized,
    type: sniffedType,
    hash: await sha256Hex(sanitized),
  };
}

export async function validateProofOnServer(proof: ValidatedProofFile): Promise<void> {
  const bytes = new Uint8Array(await proof.file.arrayBuffer());
  const binary = bytes.reduce((value, byte) => value + String.fromCharCode(byte), '');
  const response = await fetch('/api/proof-of-payout/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileBase64: btoa(binary),
      proofHash: proof.hash,
      declaredType: proof.type,
    }),
  });

  if (!response.ok) {
    throw new Error('Server rejected proof file');
  }
}
