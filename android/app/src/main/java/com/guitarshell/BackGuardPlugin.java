package com.guitarshell;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 云同步期间的最小返回键保护。
 *
 * JS 只同步一个 busy 标志；真正按返回键时由 MainActivity 拦截，
 * 再回到 Web 层弹应用内确认。这样不依赖 @capacitor/app，也不改变
 * 没有同步任务时的默认返回行为。
 */
@CapacitorPlugin(name = "BackGuard")
public class BackGuardPlugin extends Plugin {

    private volatile boolean busy = false;

    @PluginMethod
    public void setBusy(PluginCall call) {
        busy = Boolean.TRUE.equals(call.getBoolean("busy"));
        JSObject result = new JSObject();
        result.put("busy", busy);
        call.resolve(result);
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
