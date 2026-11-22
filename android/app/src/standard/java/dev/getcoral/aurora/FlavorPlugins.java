package dev.getcoral.aurora;

import com.getcapacitor.Plugin;
import java.util.Collections;
import java.util.List;

/** Plugins only one store build has. The Play Store build has none. */
final class FlavorPlugins {

    private FlavorPlugins() {}

    static List<Class<? extends Plugin>> all() {
        return Collections.emptyList();
    }
}
