#!/usr/bin/env bash
# Builds Capacitor's frameworks with a Mac Catalyst slice for the Mac app.
#
# The frameworks Capacitor publishes for Swift Package Manager only hold iOS
# and the iOS Simulator, so the Mac build can't link them. This builds the
# same version from Capacitor's source, as its own release script does, plus
# a Mac Catalyst archive, into ios/App/mac/capacitor-swift-pm. That folder is
# a local package with the same name as Capacitor's, so the AuroraMac
# workspace uses it in place of the published one.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/ios/App/mac/capacitor-swift-pm"
work="$root/ios/App/mac/.build"
version="$(node -p "require('$root/node_modules/@capacitor/ios/package.json').version")"
stamp="$out/.capacitor-version"

if [[ -f "$stamp" && "$(cat "$stamp")" == "$version" && -d "$out/Capacitor.xcframework" && "${1:-}" != "--force" ]]; then
	echo "Capacitor $version frameworks for the Mac are up to date."
	exit 0
fi

rm -rf "$work"
mkdir -p "$work"
git clone --quiet --depth 1 --branch "$version" https://github.com/ionic-team/capacitor "$work/capacitor"

archive() {
	local destination="$1" name="$2"
	xcodebuild archive \
		-quiet \
		-scheme Capacitor \
		-workspace "$work/capacitor/ios/Capacitor/Capacitor.xcworkspace" \
		-destination "$destination" \
		-archivePath "$work/$name" \
		SKIP_INSTALL=NO \
		BUILD_LIBRARY_FOR_DISTRIBUTION=YES \
		SUPPORTS_MACCATALYST=YES \
		DEBUG_INFORMATION_FORMAT=dwarf-with-dsym
	# Cordova is its own framework; don't nest a second copy in Capacitor.
	rm -rf "$work/$name.xcarchive/Products/Library/Frameworks/Capacitor.framework/Frameworks"
}

archive "generic/platform=iOS" iOS
archive "generic/platform=iOS Simulator" iOS-Simulator
archive "generic/platform=macOS,variant=Mac Catalyst" Catalyst

for framework in Capacitor Cordova; do
	rm -rf "$out/$framework.xcframework"
	args=()
	for name in iOS iOS-Simulator Catalyst; do
		args+=(-framework "$work/$name.xcarchive/Products/Library/Frameworks/$framework.framework")
		args+=(-debug-symbols "$work/$name.xcarchive/dSYMs/$framework.framework.dSYM")
	done
	xcodebuild -create-xcframework "${args[@]}" -output "$out/$framework.xcframework"
done

echo "$version" > "$stamp"
rm -rf "$work"
echo "Built Capacitor $version frameworks for iOS, the iOS Simulator and Mac Catalyst."
