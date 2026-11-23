package com.guitarshell;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * 系统相册多选。
 *
 * Android 13+ 走 Photo Picker（ACTION_PICK_IMAGES），12 以下走 ACTION_OPEN_DOCUMENT，
 * 再不行回退 ACTION_GET_CONTENT。拿到 URI 后立即流式复制到应用缓存，
 * 只把缓存文件路径返回给 JS，避免把图片转成 base64 穿过 Capacitor bridge。
 */
@CapacitorPlugin(name = "GalleryPicker")
public class GalleryPickerPlugin extends Plugin {

    private static final int MAX_IMAGES = 20;
    private static final long CACHE_TTL_MS = 24L * 60L * 60L * 1000L;
    private static final String CACHE_DIR = "gallery-picker";

    @PluginMethod
    public void pickImages(PluginCall call) {
        int limit = clampLimit(call.getInt("limit", MAX_IMAGES));
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前页面不可用", "PICK_UNAVAILABLE");
            return;
        }

        prepareCacheDir();
        Intent intent = buildPickerIntent(limit);
        if (intent == null) {
            call.reject("系统相册不可用", "PICK_UNAVAILABLE");
            return;
        }

        activity.runOnUiThread(() -> startActivityForResult(call, intent, "pickerResult"));
    }

    @ActivityCallback
    private void pickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("已取消选择", "PICK_CANCELLED");
            return;
        }

        Intent data = result.getData();
        if (data == null) {
            call.reject("没有拿到选择的照片", "PICK_EMPTY");
            return;
        }

        int limit = clampLimit(call.getInt("limit", MAX_IMAGES));
        List<Uri> uris = collectUris(data, limit);
        if (uris.isEmpty()) {
            call.reject("没有选择照片", "PICK_EMPTY");
            return;
        }

        // 复制大图不能在主线程做，否则 20 张时容易 ANR
        new Thread(() -> copyUris(call, uris)).start();
    }

    private void copyUris(PluginCall call, List<Uri> uris) {
        ContentResolver resolver = getContext().getContentResolver();
        File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        JSArray files = new JSArray();
        int failed = 0;

        for (Uri uri : uris) {
            try {
                JSObject item = copyUri(resolver, dir, uri);
                files.put(item);
            } catch (Exception err) {
                failed++;
            }
        }

        if (files.length() == 0) {
            call.reject("照片读取失败，请重试", "PICK_COPY_FAILED");
            return;
        }

        JSObject result = new JSObject();
        result.put("files", files);
        result.put("failed", failed);
        call.resolve(result);
    }

    private JSObject copyUri(ContentResolver resolver, File dir, Uri uri) throws Exception {
        String mimeType = resolver.getType(uri);
        String displayName = queryDisplayName(resolver, uri);
        String extension = resolveExtension(displayName, mimeType);
        String baseName = safeBaseName(displayName);
        String fileName = baseName + "-" + UUID.randomUUID().toString().substring(0, 8) + "." + extension;
        File target = new File(dir, fileName);

        long size;
        try (InputStream in = resolver.openInputStream(uri);
             FileOutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new Exception("无法读取照片");
            byte[] buffer = new byte[8192];
            int read;
            size = 0;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                size += read;
            }
            out.flush();
        }

        if (size <= 0) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw new Exception("照片内容为空");
        }

        JSObject item = new JSObject();
        item.put("path", target.getAbsolutePath());
        item.put("name", fileName);
        item.put("mimeType", mimeType == null ? guessMimeType(extension) : mimeType);
        item.put("size", size);
        return item;
    }

    private Intent buildPickerIntent(int limit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Intent picker = new Intent(MediaStore.ACTION_PICK_IMAGES);
            picker.setType("image/*");
            picker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, limit);
            if (canResolve(picker)) return picker;
        }

        Intent openDocument = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        openDocument.addCategory(Intent.CATEGORY_OPENABLE);
        openDocument.setType("image/*");
        openDocument.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (canResolve(openDocument)) return openDocument;

        Intent getContent = new Intent(Intent.ACTION_GET_CONTENT);
        getContent.addCategory(Intent.CATEGORY_OPENABLE);
        getContent.setType("image/*");
        getContent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (canResolve(getContent)) return getContent;

        return null;
    }

    private boolean canResolve(Intent intent) {
        return intent.resolveActivity(getContext().getPackageManager()) != null;
    }

    private List<Uri> collectUris(Intent data, int limit) {
        List<Uri> uris = new ArrayList<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount() && uris.size() < limit; i++) {
                Uri uri = clipData.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
            return uris;
        }

        Uri single = data.getData();
        if (single != null) uris.add(single);
        return uris;
    }

    private int clampLimit(int raw) {
        if (raw <= 0) return MAX_IMAGES;
        return Math.min(raw, MAX_IMAGES);
    }

    private void prepareCacheDir() {
        File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        if (!dir.exists() && !dir.mkdirs()) return;

        File[] oldFiles = dir.listFiles();
        if (oldFiles == null) return;

        long now = System.currentTimeMillis();
        for (File file : oldFiles) {
            if (now - file.lastModified() > CACHE_TTL_MS) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.trim().isEmpty()) return name;
            }
        } catch (Exception ignored) {}
        return "image";
    }

    private String resolveExtension(String displayName, String mimeType) {
        int dot = displayName.lastIndexOf('.');
        if (dot > 0 && dot < displayName.length() - 1) {
            String raw = displayName.substring(dot + 1).toLowerCase();
            if (raw.matches("jpg|jpeg|png|webp|gif|bmp|heic|heif")) {
                return raw.equals("jpeg") ? "jpg" : raw;
            }
        }

        if (mimeType != null) {
            String fromMime = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            if (fromMime != null && !fromMime.isEmpty()) {
                return fromMime.equals("jpeg") ? "jpg" : fromMime;
            }
        }
        return "jpg";
    }

    private String safeBaseName(String displayName) {
        String base = displayName == null ? "" : displayName;
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        base = base.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_").trim();
        // Photo Picker 常把显示名降级成纯数字 ID，直接当文件名对用户没有意义
        if (base.isEmpty() || base.matches("\\d{4,}") || base.equals("image")) {
            base = "照片-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        }
        if (base.length() > 48) base = base.substring(0, 48);
        return base;
    }

    private String guessMimeType(String extension) {
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "image/jpeg" : mime;
    }
}
