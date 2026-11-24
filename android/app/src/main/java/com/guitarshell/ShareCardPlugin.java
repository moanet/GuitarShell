package com.guitarshell;

import android.Manifest;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * 练习卡片：保存到系统相册 + 分享。
 *
 * 分享仍把 PNG 写进 cacheDir/cards，再用 FileProvider 交给系统分享面板；
 * 保存 Android 10+ 走 MediaStore（Pictures/GuitarShell，不需要存储权限），
 * Android 6–9 申请 WRITE_EXTERNAL_STORAGE 后写公共 Pictures/GuitarShell 并扫描。
 * WebView 不支持 navigator.share({ files })，也不认 <a download> + blob，所以壳内统一走原生通道。
 */
@CapacitorPlugin(
    name = "ShareCard",
    permissions = {
        @Permission(
            alias = "storage",
            strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
        )
    }
)
public class ShareCardPlugin extends Plugin {

    private static final String MIME_PNG = "image/png";
    private static final String FOLDER = "GuitarShell";
    private static final String DEFAULT_NAME = "GuitarShell-practice.png";

    @PluginMethod
    public void share(PluginCall call) {
        String dataUrl = call.getString("dataUrl");
        String fileName = safePngName(call.getString("fileName"));

        try {
            byte[] bytes = decodePng(dataUrl);
            File file = writeCacheFile(fileName, bytes);
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(MIME_PNG);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri("practice card", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "分享练习卡片");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject result = new JSObject();
            result.put("channel", "native");
            result.put("fileName", file.getName());
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception err) {
            call.reject("分享失败：" + err.getMessage(), err);
        }
    }

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String dataUrl = call.getString("dataUrl");
        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("卡片图片为空");
            return;
        }

        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P && !hasLegacyStoragePermission()) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        saveInBackground(call, dataUrl, safePngName(call.getString("fileName")));
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (!hasLegacyStoragePermission()) {
            call.reject("没有存储权限，无法保存到相册");
            return;
        }
        saveInBackground(call, call.getString("dataUrl"), safePngName(call.getString("fileName")));
    }

    private void saveInBackground(PluginCall call, String dataUrl, String fileName) {
        new Thread(() -> {
            try {
                byte[] bytes = decodePng(dataUrl);
                JSObject result = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? writeWithMediaStore(fileName, bytes)
                    : writeToPublicPictures(fileName, bytes);
                call.resolve(result);
            } catch (Exception err) {
                call.reject("保存失败：" + err.getMessage(), err);
            }
        }).start();
    }

    private boolean hasLegacyStoragePermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        Context context = getContext();
        return context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private String safePngName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) name = DEFAULT_NAME;
        if (!name.toLowerCase().endsWith(".png")) name = name + ".png";
        name = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "-");
        if (name.isEmpty() || name.equals(".png")) name = DEFAULT_NAME;
        if (name.length() > 120) {
            name = name.substring(0, name.length() - 4) + ".png";
        }
        return name;
    }

    private byte[] decodePng(String dataUrl) throws Exception {
        if (dataUrl == null || dataUrl.isEmpty()) throw new IOException("卡片图片为空");
        int comma = dataUrl.indexOf(',');
        String base64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        if (base64.isEmpty()) throw new IOException("卡片图片为空");

        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        if (bytes.length == 0) throw new IOException("卡片图片为空");

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) {
            throw new IOException("卡片图片解码失败");
        }
        return bytes;
    }

    private File writeCacheFile(String fileName, byte[] bytes) throws IOException {
        File dir = new File(getContext().getCacheDir(), "cards");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建卡片缓存目录");
        File file = new File(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
            out.flush();
        }
        return file;
    }

    private JSObject writeWithMediaStore(String fileName, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, MIME_PNG);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + FOLDER);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("系统相册拒绝写入");

        try {
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("无法打开相册输出流");
                out.write(bytes);
                out.flush();
            }

            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
        } catch (Exception err) {
            resolver.delete(uri, null, null);
            throw err;
        }

        String savedName = queryDisplayName(resolver, uri, fileName);
        JSObject result = new JSObject();
        result.put("channel", "gallery");
        result.put("fileName", savedName);
        result.put("path", Environment.DIRECTORY_PICTURES + "/" + FOLDER + "/" + savedName);
        result.put("uri", uri.toString());
        return result;
    }

    private JSObject writeToPublicPictures(String fileName, byte[] bytes) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), FOLDER);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建 Pictures/GuitarShell 目录");

        File file = uniqueFile(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
            out.flush();
        }

        MediaScannerConnection.scanFile(
            getContext(),
            new String[] { file.getAbsolutePath() },
            new String[] { MIME_PNG },
            null
        );

        JSObject result = new JSObject();
        result.put("channel", "gallery");
        result.put("fileName", file.getName());
        result.put("path", Environment.DIRECTORY_PICTURES + "/" + FOLDER + "/" + file.getName());
        result.put("uri", Uri.fromFile(file).toString());
        return result;
    }

    private File uniqueFile(File dir, String fileName) {
        File candidate = new File(dir, fileName);
        if (!candidate.exists()) return candidate;

        String base = fileName;
        String ext = "";
        int dot = fileName.lastIndexOf('.');
        if (dot > 0) {
            base = fileName.substring(0, dot);
            ext = fileName.substring(dot);
        }
        for (int i = 1; i < 1000; i++) {
            File next = new File(dir, base + " (" + i + ")" + ext);
            if (!next.exists()) return next;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri, String fallback) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {}
        return fallback;
    }
}
