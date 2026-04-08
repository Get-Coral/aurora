import { execFileSync, spawnSync } from 'node:child_process'

const SETTINGS_BUNDLE_ID = 'com.apple.Preferences'
const APP_BUNDLE_ID = 'com.eliancodes.aurora'
const SIMULATOR_READY_RETRIES = 12
const SIMULATOR_READY_DELAY_MS = 5000

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    ...options,
  })
}

function getAvailableSimulators() {
  const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
    encoding: 'utf8',
  })

  const parsed = JSON.parse(raw)
  const devicesByRuntime = parsed.devices ?? {}

  return Object.entries(devicesByRuntime)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, devices]) => devices)
    .map((device) => ({
      id: device.udid,
      name: device.name,
      state: device.state,
    }))
}

function selectSimulator() {
  const explicitTarget = process.env.AURORA_IOS_TARGET?.trim()
  if (explicitTarget) {
    const explicitSimulator = getAvailableSimulators().find((device) => device.id === explicitTarget)

    if (explicitSimulator) {
      return explicitSimulator
    }

    return {
      id: explicitTarget,
      name: explicitTarget,
      state: 'unknown',
    }
  }

  const simulators = getAvailableSimulators()
  if (simulators.length === 0) {
    throw new Error('No available iOS simulators were found in Xcode.')
  }

  const preferred =
    simulators.find((device) => device.state === 'Booted' && device.name.includes('iPhone')) ??
    simulators.find((device) => device.name.includes('iPhone')) ??
    simulators[0]

  if (!preferred) {
    throw new Error('No usable iOS simulator target was found.')
  }

  return preferred
}

function ensureSimulatorBooted(simulator) {
  if (simulator.state !== 'Booted') {
    const bootResult = runCommand('xcrun', ['simctl', 'boot', simulator.id])

    if (bootResult.status !== 0 && !bootResult.stderr?.includes('Unable to boot device in current state: Booted')) {
      process.stderr.write(bootResult.stderr ?? bootResult.stdout ?? '')
      process.exit(bootResult.status ?? 1)
    }
  }

  const bootStatusResult = runCommand('xcrun', ['simctl', 'bootstatus', simulator.id, '-b'], {
    stdio: 'inherit',
  })

  if (bootStatusResult.status !== 0) {
    process.exit(bootStatusResult.status ?? 1)
  }

  runCommand('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', simulator.id])
}

function waitForStableLaunchServices(target) {
  for (let attempt = 0; attempt < SIMULATOR_READY_RETRIES; attempt += 1) {
    const launchResult = runCommand('xcrun', ['simctl', 'launch', target, SETTINGS_BUNDLE_ID])

    if (launchResult.status === 0) {
      runCommand('xcrun', ['simctl', 'terminate', target, SETTINGS_BUNDLE_ID])
      return
    }

    sleep(SIMULATOR_READY_DELAY_MS)
  }

  throw new Error('The selected iOS simulator never became ready to launch apps.')
}

const simulator = selectSimulator()
const target = simulator.id

ensureSimulatorBooted(simulator)
waitForStableLaunchServices(target)

const capacitorRun = runCommand('pnpm', ['exec', 'cap', 'run', 'ios', '--target', target], {
  stdio: 'inherit',
})

process.exit(capacitorRun.status ?? 1)
