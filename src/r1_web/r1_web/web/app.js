async function loadStatus() {
  const res = await fetch("/status");
  const data = await res.json();

  document.getElementById("status").innerText =
    `Robot: ${data.robot}, Web node: ${data.web_node}`;
}

async function sendTeleopKey(key) {
  const teleopStatus = document.getElementById("teleop-status");

  try {
    const encodedKey = key === " " ? "space" : encodeURIComponent(key);
    const res = await fetch(`/teleop/${encodedKey}`, {
      method: "POST"
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Teleop request failed");
    }

    teleopStatus.innerText = `Queued ${data.key.toUpperCase()}; waiting for hardware.`;
    window.setTimeout(() => loadHardwareStatus(data.request_id), 150);
  } catch (error) {
    teleopStatus.innerText = `Teleop error: ${error.message}`;
  }
}

async function loadHardwareStatus(requestId, attemptsRemaining = 8) {
  const teleopStatus = document.getElementById("teleop-status");

  try {
    const res = await fetch("/hardware/status");
    const data = await res.json();

    if (!res.ok || data.ok === false) {
      teleopStatus.innerText = data.error || "No action status available yet.";
      return;
    }

    // PTZ moves complete asynchronously relative to the HTTP request. Wait for
    // the matching ROS action status instead of displaying a stale command.
    if (requestId && data.request_id !== requestId) {
      if (attemptsRemaining > 0) {
        window.setTimeout(
          () => loadHardwareStatus(requestId, attemptsRemaining - 1),
          150,
        );
      } else {
        teleopStatus.innerText = "Command is still pending hardware confirmation.";
      }
      return;
    }

    const result = data.result || {};
    const wheels = data.wheels || {};
    const ptz = data.ptz || {};
    if (!result.ok) {
      teleopStatus.innerText = `Hardware rejected command: ${result.error || "unknown error"}`;
      return;
    }

    teleopStatus.innerText = `Executed ${result.command || data.executed_action}; wheels: ${wheels.status || "unknown"}; PTZ: ${ptz.angle ?? "unknown"}`;
  } catch (error) {
    teleopStatus.innerText = `Unable to read hardware status: ${error.message}`;
  }
}

function installTeleopButtons() {
  document.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      sendTeleopKey(button.dataset.key);
    });
  });
}

function installKeyboardTeleop() {
  const allowedKeys = new Set(["w", "a", "s", "d", "q", "e", "z", "c", " "]);

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (!allowedKeys.has(key)) {
      return;
    }

    if (event.repeat) {
      return;
    }

    event.preventDefault();
    sendTeleopKey(key);
  });
}

loadStatus();
installTeleopButtons();
installKeyboardTeleop();
