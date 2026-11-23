package com.guitarshell;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 最小返回键保护：云同步 busy + 前端浮层层级。
 *
 * JS 同步 busy 与 layerDepth；真正按返回键时由 MainActivity 拦截：
 * 有浮层时派发 gs-back-request，同步中派发 gs-cloud-exit-request，
 * 否则走默认返回。这样不依赖 @capacitor/app。
 */
@CapacitorPlugin(name = "BackGuard")
public class BackGuardPlugin extends Plugin {

    private volatile boolean busy = false;
    private volatile int layerDepth = 0;

    @PluginMethod
    public void setBusy(PluginCall call) {
        busy = Boolean.TRUE.equals(call.getBoolean("busy"));
        JSObject result = new JSObject();
        result.put("busy", busy);
        call.resolve(result);
    }

    @PluginMethod
    public void setLayerDepth(PluginCall call) {
        Integer depth = call.getInt("depth", 0);
        layerDepth = Math.max(0, depth == null ? 0 : depth);
        JSObject result = new JSObject();
        result.put("depth", layerDepth);
        call.resolve(result);
    }

    public int getLayerDepth() {
        return layerDepth;
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().finish());
    }

    public boolean isBusy() {
        return busy;
    }
}
