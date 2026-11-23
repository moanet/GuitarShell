package com.guitarshell;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    // 启动层总时长 1.0s：显示 800ms + 淡出 200ms；160ms 淡入包含在显示窗口内
    private static final long SPLASH_HOLD_MS = 800;
    private static final long SPLASH_FADE_MS = 200;

    private WebView splashOverlay;
    private final Runnable splashFadeRunnable = new Runnable() {
        @Override
        public void run() {
            fadeOutSplash();
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAwakePlugin.class);
        registerPlugin(SaveBackupPlugin.class);
        registerPlugin(ThemeBarsPlugin.class);
        registerPlugin(BackGuardPlugin.class);
        super.onCreate(savedInstanceState);
        applyThemeSystemBars("deep");
        if (savedInstanceState == null) showSplashOverlay();
    }

    public void applyThemeSystemBars(String theme) {
        boolean light = "light".equals(theme);
        int barColor = light ? Color.rgb(243, 237, 227) : Color.rgb(14, 16, 19);
        getWindow().setStatusBarColor(barColor);
        getWindow().setNavigationBarColor(barColor);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        if (light) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        } else {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    private void showSplashOverlay() {
        if (splashOverlay != null) return;
        FrameLayout root = findViewById(android.R.id.content);
        if (root == null) return;

        WebView splash = new WebView(this);
        splash.setBackgroundColor(Color.rgb(14, 16, 19));
        splash.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        splash.setVerticalScrollBarEnabled(false);
        splash.setHorizontalScrollBarEnabled(false);
        splash.setOverScrollMode(View.OVER_SCROLL_NEVER);
        splash.setFocusable(false);
        splash.setClickable(false);
        splash.setOnTouchListener((view, event) -> true);
        splash.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);

        WebSettings settings = splash.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setDomStorageEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        splash.setWebViewClient(new WebViewClient());
        splash.loadUrl("file:///android_asset/splash.html");

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        splash.setAlpha(0f);
        root.addView(splash, params);
        splashOverlay = splash;

        splash.animate().alpha(1f).setDuration(160).start();
        splash.postDelayed(splashFadeRunnable, SPLASH_HOLD_MS);
    }

    private void fadeOutSplash() {
        final WebView splash = splashOverlay;
        if (splash == null) return;
        splash.animate()
            .alpha(0f)
            .setDuration(SPLASH_FADE_MS)
            .withEndAction(new Runnable() {
                @Override
                public void run() {
                    ViewParent parent = splash.getParent();
                    if (parent instanceof ViewGroup) {
                        ((ViewGroup) parent).removeView(splash);
                    }
                    splash.destroy();
                    if (splashOverlay == splash) splashOverlay = null;
                }
            })
            .start();
    }

    @Override
    public void onBackPressed() {
        PluginHandle handle = getBridge() != null ? getBridge().getPlugin("BackGuard") : null;
        BackGuardPlugin guard = null;
        if (handle != null && handle.getInstance() instanceof BackGuardPlugin) {
            guard = (BackGuardPlugin) handle.getInstance();
        }

        // 有浮层时先交给前端关闭最上层；只有层栈为空才考虑退出应用或云同步确认
        if (guard != null && guard.getLayerDepth() > 0) {
            dispatchBackRequest("gs-back-request");
            return;
        }

        if (guard != null && guard.isBusy()) {
            dispatchBackRequest("gs-cloud-exit-request");
            return;
        }

        super.onBackPressed();
    }

    private void dispatchBackRequest(String eventName) {
        if (getBridge() == null) return;
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('" + eventName + "'))", null));
    }

    @Override
    public void onDestroy() {
        if (splashOverlay != null) {
            splashOverlay.removeCallbacks(splashFadeRunnable);
            ViewParent parent = splashOverlay.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(splashOverlay);
            }
            splashOverlay.destroy();
            splashOverlay = null;
        }
        super.onDestroy();
    }
}
