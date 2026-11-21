package dev.getcoral.aurora;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app whether it runs on a TV. Many Android TV / Google TV
 * WebViews don't say so in their user agent, so the web layer can't find out
 * on its own.
 */
@CapacitorPlugin(name = "AuroraTv")
public class AuroraTvPlugin extends Plugin {

    @PluginMethod
    public void isTelevision(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", isTelevision(getContext()));
        call.resolve(result);
    }

    static boolean isTelevision(Context context) {
        UiModeManager uiModeManager = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        if (uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            return true;
        }
        return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }
}
