async function loadStatus() {
  const res = await fetch("/status");
  const data = await res.json();

  document.getElementById("status").innerText =
    `Robot: ${data.robot}, Web node: ${data.web_node}`;
}

async function sendTest() {
  await fetch("/say/hello-from-web", {
    method: "POST"
  });

  alert("Sent message to ROS topic /web/status");
}

loadStatus();