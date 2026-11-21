export class FakeR2 {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string }
  >();

  async put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    this.objects.set(key, {
      bytes: new Uint8Array(value),
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = new Uint8Array(stored.bytes);
    return {
      body: new Blob([stored.bytes as unknown as BlobPart], {
        type: stored.contentType,
      }),
      async arrayBuffer() {
        return bytes.buffer;
      },
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  has(key: string) {
    return this.objects.has(key);
  }

  keys() {
    return [...this.objects.keys()];
  }
}
