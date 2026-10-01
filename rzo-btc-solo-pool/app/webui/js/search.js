"use strict";

const input = document.getElementById("dashboard-address-input");
const button = document.getElementById("dashboard-address-button");
const message = document.getElementById("dashboard-address-message");

function openMinerDashboard() {
  const address = input.value.trim();

  if (!address) {
    message.textContent = "Bitte zuerst eine Bitcoin-Adresse eingeben.";
    message.classList.add("is-error");
    input.focus();
    return;
  }

  message.textContent = "";
  message.classList.remove("is-error");

  window.location.href =
    `/miner.html?address=${encodeURIComponent(address)}`;
}

button?.addEventListener("click", openMinerDashboard);

input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    openMinerDashboard();
  }
});
