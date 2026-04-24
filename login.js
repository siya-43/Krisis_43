const API_BASE = localStorage.getItem("ecg-api-base") || "/api";

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  // Check connectivity
  checkSystemStatus();
  setInterval(checkSystemStatus, 10000);

  async function checkSystemStatus() {
    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, "")}/health`);
      if (response.ok) {
        statusDot.className = "status-dot online";
        statusText.textContent = "System Gateway Online";
      } else {
        throw new Error();
      }
    } catch {
      statusDot.className = "status-dot";
      statusText.textContent = "System Gateway Offline";
    }
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const user = usernameInput.value.trim();
    const pass = passwordInput.value.trim();

    // In a real app, this would be a POST to /api/login
    // For this prototype, we use the agreed upon hardcoded credentials
    if (user === "admin" && pass === "crisis2026") {
      localStorage.setItem("ecg_auth_token", "mock_token_" + Date.now());
      window.location.href = "./index.html";
    } else {
      alert("Invalid Operator ID or Access Key. Please try again.");
      passwordInput.value = "";
    }
  });
});
