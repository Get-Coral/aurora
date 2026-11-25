package dev.getcoral.aurora;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created.
        registerPlugin(AuroraTvPlugin.class);
        registerPlugin(AuroraPlayerPlugin.class);
        for (Class<? extends com.getcapacitor.Plugin> plugin : FlavorPlugins.all()) {
            registerPlugin(plugin);
        }
        super.onCreate(savedInstanceState);
    }
}
