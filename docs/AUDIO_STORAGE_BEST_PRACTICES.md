# Ses Kayıtları için S3/MinIO Storage Best Practices

## 📋 Mevcut Durum

### ✅ Şu An Yapılanlar (İyi)
1. **Klasör Yapısı**: `audio/` klasörü kullanılıyor ✅
2. **Dosya Boyutu Limiti**: 10MB limit var ✅
3. **MIME Type Kontrolü**: Sadece audio dosyaları kabul ediliyor ✅
4. **Memory Storage**: Multer memory storage kullanılıyor (S3 için uygun) ✅
5. **UUID Dosya İsimleri**: Güvenlik için UUID kullanılıyor ✅

### ⚠️ İyileştirilmesi Gerekenler

1. **Presigned URL Eksik**: Fotoğraflar gibi ses kayıtları için presigned URL kullanılmıyor
2. **Audio URL Transformasyonu**: Mesajlar dönerken audio URL'ler presigned'e çevrilmiyor
3. **Error Handling**: Daha detaylı hata yönetimi gerekebilir
4. **Compression**: Opsiyonel olarak ses sıkıştırma eklenebilir

---

## 🎯 Best Practices

### 1. **Presigned URL Kullanımı** (ÖNEMLİ)

**Neden?**
- Güvenlik: Doğrudan S3/MinIO URL'leri herkese açık olabilir
- Erişim Kontrolü: Presigned URL'ler zaman sınırlı erişim sağlar
- Maliyet: Sadece yetkili kullanıcılar dosyalara erişir

**Fotoğraflar için nasıl yapılıyor:**
```typescript
// Backend: transformPhotoUrls() kullanılıyor
const photos = await StorageService.transformPhotoUrls(otherProfile.photos, 3600);
```

**Ses kayıtları için de aynısını yapmalıyız:**
```typescript
// Mesajlar dönerken audioUrl'leri presigned'e çevir
const audioUrl = msg.audioUrl 
  ? await StorageService.getPresignedUrl(msg.audioUrl, 3600)
  : null;
```

### 2. **Klasör Yapısı**

Mevcut yapı iyi:
```
audio/
  ├── {uuid}.m4a
  ├── {uuid}.m4a
  └── ...
```

Alternatif (daha organize):
```
audio/
  ├── {year}/
  │   ├── {month}/
  │   │   └── {uuid}.m4a
  └── ...
```

### 3. **Dosya Formatı ve Boyut**

**Mevcut:**
- Format: `.m4a` (AAC codec) ✅
- Limit: 10MB ✅
- MIME: `audio/m4a`, `audio/mp4` ✅

**Öneriler:**
- Format: `.m4a` kalabilir (iyi compression, kalite)
- Limit: 10MB makul (1-2 dakika ses için yeterli)
- Alternatif: `.opus` daha küçük dosya boyutu (gelecekte)

### 4. **Metadata ve Tagging**

S3/MinIO'da metadata eklenebilir:
```typescript
Metadata: {
  'uploaded-by': userId,
  'conversation-id': conversationId,
  'message-id': messageId,
  'duration': durationInSeconds, // Opsiyonel
  'file-size': fileSize,
}
```

### 5. **Lifecycle Policies** (Opsiyonel)

Eski ses kayıtlarını otomatik silmek için:
- 90 gün sonra sil
- Veya arşivle (Glacier gibi)

### 6. **CDN Entegrasyonu** (Gelecek)

- Cloudflare R2 veya AWS CloudFront
- Daha hızlı global erişim
- Daha düşük maliyet

---

## 🔧 Implementasyon Önerileri

### 1. StorageService'e Audio URL Transform Metodu Ekle

```typescript
// src/lib/storage.ts
static async transformAudioUrl(audioUrl: string | null, expiresIn: number = 3600): Promise<string | null> {
  if (!audioUrl) return null;
  return this.getPresignedUrl(audioUrl, expiresIn);
}

static async transformAudioUrls(audioUrls: (string | null)[], expiresIn: number = 3600): Promise<(string | null)[]> {
  if (!audioUrls || audioUrls.length === 0) return [];
  
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
    return audioUrls;
  }
  
  return Promise.all(
    audioUrls.map(url => this.transformAudioUrl(url, expiresIn))
  );
}
```

### 2. Mesaj Endpoint'lerinde Audio URL'leri Transform Et

```typescript
// src/modules/chat/routes.ts

// GET /conversations/:id/messages
router.get("/conversations/:conversationId/messages", ..., async (req, res, next) => {
  // ...
  const messages = await (prisma as any).message.findMany(...);
  
  // Transform audio URLs to presigned URLs
  const messagesWithPresignedUrls = await Promise.all(
    messages.map(async (msg: any) => ({
      id: msg.id,
      conversationId: msg.conversationId,
      senderUserId: msg.senderUserId,
      text: msg.text,
      audioUrl: msg.audioUrl 
        ? await StorageService.getPresignedUrl(msg.audioUrl, 3600)
        : null,
      createdAt: msg.createdAt.toISOString(),
    }))
  );
  
  res.json(messagesWithPresignedUrls);
});
```

### 3. Upload Sırasında Metadata Ekle

```typescript
// src/modules/chat/routes.ts - audio upload endpoint
const audioUrl = await StorageService.uploadFile(req.file, "audio", {
  metadata: {
    'uploaded-by': userId,
    'conversation-id': conversationId,
  }
});
```

### 4. StorageService.uploadFile'a Metadata Parametresi Ekle

```typescript
// src/lib/storage.ts
static async uploadFile(
  file: Express.Multer.File, 
  folder: string = "uploads",
  options?: { metadata?: Record<string, string> }
): Promise<string> {
  // ...
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
    Metadata: options?.metadata || {},
  });
  // ...
}
```

---

## 📊 Karşılaştırma: Fotoğraflar vs Ses Kayıtları

| Özellik | Fotoğraflar | Ses Kayıtları | Durum |
|---------|------------|--------------|-------|
| Presigned URL | ✅ Var | ❌ Yok | **İyileştirilmeli** |
| Klasör | `profiles/` | `audio/` | ✅ İyi |
| Dosya Boyutu | 5MB | 10MB | ✅ İyi |
| MIME Kontrolü | ✅ Var | ✅ Var | ✅ İyi |
| Metadata | ❌ Yok | ❌ Yok | Opsiyonel |
| Lifecycle Policy | ❌ Yok | ❌ Yok | Opsiyonel |

---

## 🚀 Öncelik Sırası

1. **YÜKSEK**: Presigned URL implementasyonu (güvenlik)
2. **ORTA**: Metadata ekleme (debugging ve analytics için)
3. **DÜŞÜK**: Lifecycle policies (maliyet optimizasyonu)
4. **DÜŞÜK**: CDN entegrasyonu (performans)

---

## 📝 Notlar

- Presigned URL'ler 1 saat (3600 saniye) geçerli olmalı
- Audio URL'ler null olabilir (text mesajlar için)
- Error handling: Presigned URL oluşturulamazsa orijinal URL döndür
- Test: Hem S3 hem MinIO ile test edilmeli
