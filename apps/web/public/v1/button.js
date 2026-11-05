/* Merchant Capital+ pay button (FR-GW-4): <script src="https://GATEWAY/v1/button.js" data-session="ID"></script>
 * or data-link="SLUG"; optional data-label. Or load it once and mark your own elements: data-mc-session="ID".
 * Opens the hosted checkout on the gateway that served this file. No dependencies, no requests. */
(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  var ID = /^[\w-]{1,64}$/;

  function destination(el) {
    var session = el.getAttribute("data-mc-session"), link = el.getAttribute("data-mc-link");
    if (session !== null) return ID.test(session) ? origin + "/checkout/" + session : null;
    return link !== null && ID.test(link) ? origin + "/l/" + link : null;
  }
  function complain() {
    console.error("Merchant Capital+ button: bad data-session/data-link (letters, digits, - and _ only).");
  }

  if (!window.__mcPayButton) {
    window.__mcPayButton = true;
    document.addEventListener("click", function (event) {
      var el = event.target && event.target.closest && event.target.closest("[data-mc-session],[data-mc-link]");
      if (!el) return;
      var url = destination(el);
      if (!url) return complain();
      event.preventDefault();
      location.assign(url);
    });
  }

  var session = script.getAttribute("data-session"), link = script.getAttribute("data-link");
  if (session === null && link === null) return;
  var button = document.createElement("button");
  button.type = "button";
  button.className = "mc-pay-button";
  button.setAttribute(session !== null ? "data-mc-session" : "data-mc-link", session !== null ? session : link);
  if (!destination(button)) return complain();
  button.textContent = script.getAttribute("data-label") || "Pay with USDT";
  button.style.cssText = "font:600 16px/1.25 system-ui,sans-serif;padding:12px 22px;border:0;border-radius:10px;background:#3b4fd9;color:#fff;cursor:pointer";
  script.insertAdjacentElement("afterend", button);
})();
