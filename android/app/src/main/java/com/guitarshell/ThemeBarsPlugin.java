package com.guitarshell;

import android.app.Activity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 把网页主题同步到 Android 系统栏。
 * 只改颜色和图标明暗，不动布局，也不参与 WebView 内容。
 */
@CapacitorPlugin(name = "ThemeBars")
public class ThemeBarsPlugin extends Plugin {

    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = "light".equals(call.getString("theme", "deep")) ? "light" : "deep";
        Activity activity = getActivity();
        if (!(activity instanceof MainActivity)) {
            call.reject("ThemeBars requires MainActivity");
            return;
        }
        // 冷启动时原生启动层要先于 WebView 读主题，因此这里同步落一份原生偏好
        MainActivity.saveStoredTheme(getContext(), theme);
        activity.runOnUiThread(() -> ((MainActivity) activity).applyThemeSystemBars(theme));
        call.resolve();
    }
}
