/* Hamburger tool menu: close on outside click, link activation, or Escape. */
(function () {
  var menus = Array.prototype.slice.call(document.querySelectorAll("details.tool-menu"));
  if (!menus.length) return;

  function close(menu) {
    menu.open = false;
  }

  document.addEventListener("click", function (event) {
    menus.forEach(function (menu) {
      if (menu.open && !menu.contains(event.target)) close(menu);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    menus.forEach(function (menu) {
      if (!menu.open) return;
      close(menu);
      var summary = menu.querySelector("summary");
      if (summary) summary.focus();
    });
  });

  menus.forEach(function (menu) {
    menu.addEventListener("toggle", function () {
      if (!menu.open) return;
      menus.forEach(function (other) {
        if (other !== menu) close(other);
      });
    });
    Array.prototype.forEach.call(menu.querySelectorAll("a"), function (link) {
      link.addEventListener("click", function () {
        close(menu);
      });
    });
  });
})();
