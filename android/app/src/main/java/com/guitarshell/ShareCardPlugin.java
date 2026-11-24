package com.guitarshell;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * 练习卡片分享：把前端导出的 PNG 写进 cacheDir/cards，再用 FileProvider 交给系统分享面板。
 *
 * WebView 不支持 navigator.share({ files })，也不认 <a download> + blob，
 * 所以壳内统一走这条原生通道；不引入 @capacitor/share，复用现有 FileProvider 配置。
 */
@CapacitorPlugin(name = "ShareCard")
public class ShareCardPlugin extends Plugin {

    @PluginMethod
    public void share(PluginCall call) {
        String dataUrl = call.getString("dataUrl");
        String fileName = call.getString("fileName");

        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("卡片图片为空");
            return;
        }
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "GuitarShell-practice.png";
        }
        if (!fileName.toLowerCase().endsWith(".png")) {
            fileName = fileName + ".png";
        }
        // 只保留一个安全文件名，防止路径穿越
        fileName = fileName.replaceAll("[\\\\/:*?\"<>|]", "-");

        try {
            int comma = dataUrl.indexOf(',');
            String base64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);

            File dir = new File(getContext().getCacheDir(), "cards");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建卡片缓存目录");
            File file = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
                out.flush();
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
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
}
