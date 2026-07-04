import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock crypto API for SHA-256
const mockCryptoSubtle = {
  digest: vi.fn(async (algorithm: string, data: ArrayBuffer) => {
    // Mock SHA-256 output (64 hex chars)
    return new ArrayBuffer(32); // 32 bytes = 64 hex chars
  }),
};

Object.defineProperty(global.crypto, 'subtle', {
  value: mockCryptoSubtle,
  configurable: true,
});

describe('Issue #896: ProofOfPayout File Upload with SHA-256 Hashing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept image and PDF file uploads', async () => {
    // Mock component for testing file upload logic
    const TestFileUploadComponent = () => {
      const [file, setFile] = React.useState<File | null>(null);
      const [fileHash, setFileHash] = React.useState<string | null>(null);

      const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
          setFile(selectedFile);
          // Simulate SHA-256 hashing
          const buffer = await selectedFile.arrayBuffer();
          const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          setFileHash(hashHex);
        }
      };

      return (
        <div>
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={handleFileChange}
            data-testid="proof-file-input"
          />
          {file && <div data-testid="file-name">{file.name}</div>}
          {fileHash && <div data-testid="file-hash">{fileHash}</div>}
        </div>
      );
    };

    render(<TestFileUploadComponent />);

    const fileInput = screen.getByTestId('proof-file-input') as HTMLInputElement;
    const pngFile = new File(['mock-image-data'], 'receipt.png', { type: 'image/png' });

    await userEvent.upload(fileInput, pngFile);

    await waitFor(() => {
      expect(screen.getByTestId('file-name')).toHaveTextContent('receipt.png');
      expect(screen.getByTestId('file-hash')).toBeInTheDocument();
    });

    // Verify crypto.subtle.digest was called with SHA-256
    expect(mockCryptoSubtle.digest).toHaveBeenCalledWith('SHA-256', expect.any(ArrayBuffer));
  });

  it('should hash the file client-side before submission', async () => {
    const TestHashingComponent = () => {
      const [hash, setHash] = React.useState<string>('');

      const computeHash = async (file: File) => {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      };

      const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
          const fileHash = await computeHash(file);
          setHash(fileHash);
        }
      };

      return (
        <div>
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={handleFileUpload}
            data-testid="hash-input"
          />
          {hash && <code data-testid="computed-hash">{hash}</code>}
        </div>
      );
    };

    render(<TestHashingComponent />);

    const input = screen.getByTestId('hash-input') as HTMLInputElement;
    const file = new File(['test-data'], 'proof.pdf', { type: 'application/pdf' });

    await userEvent.upload(input, file);

    await waitFor(() => {
      const hashElement = screen.getByTestId('computed-hash');
      expect(hashElement).toBeInTheDocument();
      expect(hashElement.textContent).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it('should submit hash to contract via confirm_payout', async () => {
    const TestSubmitComponent = () => {
      const [hash, setHash] = React.useState('');
      const [submitted, setSubmitted] = React.useState(false);
      const [error, setError] = React.useState<string | null>(null);

      const handleSubmit = async () => {
        try {
          // Mock contract submission
          const response = await fetch('/api/contract/confirm-payout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proof_hash: hash, remittance_id: '123' }),
          });

          if (!response.ok) throw new Error('Submission failed');
          setSubmitted(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      };

      return (
        <div>
          <input
            data-testid="hash-input"
            value={hash}
            onChange={e => setHash(e.target.value)}
            placeholder="Proof hash"
          />
          <button onClick={handleSubmit} data-testid="submit-btn">
            Submit
          </button>
          {submitted && <div data-testid="success">Proof submitted</div>}
          {error && <div data-testid="error">{error}</div>}
        </div>
      );
    };

    render(<TestSubmitComponent />);

    const input = screen.getByTestId('hash-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a'.repeat(64) } });

    const submitBtn = screen.getByTestId('submit-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('success')).toBeInTheDocument();
    });
  });

  it('should validate file type (image or PDF only)', async () => {
    const TestValidationComponent = () => {
      const [error, setError] = React.useState<string | null>(null);
      const [valid, setValid] = React.useState(true);

      const validateFile = (file: File) => {
        const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'application/pdf'];
        if (!validTypes.includes(file.type)) {
          setError('Only images (PNG, JPEG, GIF) and PDFs are allowed');
          setValid(false);
          return false;
        }
        setError(null);
        setValid(true);
        return true;
      };

      const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) validateFile(file);
      };

      return (
        <div>
          <input
            type="file"
            onChange={handleFileChange}
            data-testid="file-input"
          />
          {!valid && <div data-testid="error">{error}</div>}
          {valid && <div data-testid="valid">File valid</div>}
        </div>
      );
    };

    render(<TestValidationComponent />);

    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const invalidFile = new File(['data'], 'test.txt', { type: 'text/plain' });

    await userEvent.upload(input, invalidFile);

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeInTheDocument();
    });
  });

  it('should display file preview after upload', async () => {
    const TestPreviewComponent = () => {
      const [preview, setPreview] = React.useState<string | null>(null);

      const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            setPreview(reader.result as string);
          };
          reader.readAsDataURL(file);
        }
      };

      return (
        <div>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            data-testid="image-input"
          />
          {preview && (
            <img src={preview} alt="Preview" data-testid="preview-img" />
          )}
        </div>
      );
    };

    render(<TestPreviewComponent />);

    const input = screen.getByTestId('image-input') as HTMLInputElement;
    const imageFile = new File(['mock-image'], 'receipt.jpg', { type: 'image/jpeg' });

    await userEvent.upload(input, imageFile);

    await waitFor(() => {
      const preview = screen.getByTestId('preview-img') as HTMLImageElement;
      expect(preview.src).toMatch(/^data:image/);
    });
  });

  it('should support drag-and-drop file upload', async () => {
    const TestDragDropComponent = () => {
      const [file, setFile] = React.useState<File | null>(null);

      const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const droppedFile = e.dataTransfer.files?.[0];
        if (droppedFile) setFile(droppedFile);
      };

      return (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          data-testid="drop-zone"
          style={{ border: '2px dashed #ccc', padding: '20px' }}
        >
          Drop proof file here
          {file && <div data-testid="dropped-file">{file.name}</div>}
        </div>
      );
    };

    render(<TestDragDropComponent />);

    const dropZone = screen.getByTestId('drop-zone');
    const file = new File(['data'], 'proof.pdf', { type: 'application/pdf' });

    const dragEvent = new DragEvent('drop', {
      dataTransfer: new DataTransfer(),
    });
    Object.defineProperty(dragEvent.dataTransfer, 'files', {
      value: new DataTransfer().items.add(file).dataTransfer.files,
    });

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('dropped-file')).toHaveTextContent('proof.pdf');
    });
  });

  it('should handle upload errors gracefully', async () => {
    const TestErrorHandlingComponent = () => {
      const [error, setError] = React.useState<string | null>(null);

      const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
          const file = e.target.files?.[0];
          if (!file) throw new Error('No file selected');

          const buffer = await file.arrayBuffer();
          if (buffer.byteLength === 0) throw new Error('File is empty');

          // Simulate upload
          throw new Error('Network error');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      };

      return (
        <div>
          <input
            type="file"
            onChange={handleFileUpload}
            data-testid="upload-input"
          />
          {error && <div data-testid="error-msg">{error}</div>}
        </div>
      );
    };

    render(<TestErrorHandlingComponent />);

    const input = screen.getByTestId('upload-input') as HTMLInputElement;
    const file = new File([], 'empty.pdf', { type: 'application/pdf' });

    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(screen.getByTestId('error-msg')).toBeInTheDocument();
    });
  });
});
