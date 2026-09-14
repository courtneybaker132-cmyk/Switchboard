/* APPLICATION */
(function () {
  "use strict";
  var COLS = 22, ROWS = 6, cells = [], timers = [];
  var board = document.getElementById("board");
  var defaults = {sound:false, chime:true, volume:0.18, brightness:100,
    pattern:"corners", speed:"normal", ambient:"rainbow"};
  var settings = {}, key, saved;
  for (key in defaults) settings[key] = defaults[key];
  try {
    saved = JSON.parse(localStorage.getItem("mini-board-preferences-v1"));
    if (saved) for (key in defaults) {
      if (typeof saved[key] === typeof defaults[key]) settings[key] = saved[key];
    }
  } catch (e) {}
  function clamp(n, lo, hi) { return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  settings.volume = clamp(settings.volume, 0, 0.4);
  settings.brightness = clamp(settings.brightness, 20, 100);
  if (["corners","border","rainbow","none"].indexOf(settings.pattern) < 0) settings.pattern = "corners";
  if (["slow","normal","quick"].indexOf(settings.speed) < 0) settings.speed = "normal";
  if (["off","rainbow","seasonal","wave","checker","diamond","heart","chase"].indexOf(settings.ambient) < 0) settings.ambient = "rainbow";

  var customKey = "mini-board-custom-messages-v1";
  var activeKey = "mini-board-active-message-v1";
  var alarmKey = "mini-board-alarm-v1";
  var customMessages = {anytime:[], morning:[], afternoon:[], evening:[], night:[]};
  var alarmSettings = {enabled:false, time:"07:00", repeat:"daily", message:"GOOD MORNING", sound:true, lastDate:""};
  try {
    var customSaved = JSON.parse(localStorage.getItem(customKey));
    if (customSaved) for (key in customMessages) {
      if (Object.prototype.toString.call(customSaved[key]) === "[object Array]") customMessages[key] = customSaved[key];
    }
  } catch (e) {}
  try {
    var alarmSaved = JSON.parse(localStorage.getItem(alarmKey));
    if (alarmSaved) for (key in alarmSettings) {
      if (typeof alarmSaved[key] === typeof alarmSettings[key]) alarmSettings[key] = alarmSaved[key];
    }
  } catch (e) {}
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(alarmSettings.time)) alarmSettings.time = "07:00";
  if (["daily","weekdays","weekends","once"].indexOf(alarmSettings.repeat) < 0) alarmSettings.repeat = "daily";

  var audio = null, wakeLock = null, wakePending = false, hideTimer = null;
  var override = null, alarmActive = false, alarmChimeAt = 0, snoozeAt = 0;
  var mode = "normal", paused = false, pausedAt = 0, pauseRemaining = 0;
  var scene = null, sceneUntil = 0, step = 0, lastMessage = -1, lastQuote = -1;
  var lastPeriod = "", lastFrame = "", lastColors = "", generation = 0;
  var focusPhase = "focus", focusEnd = 0, breathStart = 0;
  var ambientStep = 0, ambientUntil = 0, ambientColors = null;
  var periodColors = {morning:"yellow", afternoon:"blue", evening:"orange", night:"purple"};
  var rainbow = ["red","orange","yellow","green","blue","purple","white"];
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?$#@&+-";
  function id(name) { return document.getElementById(name); }
  function period(hour) {
    return hour < 6 || hour >= 22 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  }
  function frame(lines) {
    var output = "";
    for (var r = 0; r < ROWS; r++) {
      var text = String(lines[r] || "").toUpperCase().slice(0, COLS);
      var left = Math.floor((COLS - text.length) / 2);
      output += (new Array(left + 1).join(" ") + text + new Array(23).join(" ")).slice(0, COLS);
    }
    return output;
  }
  function reduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function fit() {
    var w = Math.min(window.innerWidth * 0.96, window.innerHeight * 0.92 * 1.87);
    var h = w / 1.87;
    board.style.width = w + "px";
    board.style.height = h + "px";
    board.style.fontSize = Math.min(34, w / 22 * 0.7) + "px";
    board.style.lineHeight = (h / 6 - 4) + "px";
  }
  for (var r = 0; r < ROWS; r++) {
    var row = document.createElement("div");
    row.className = "board-row";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("span");
      tile.className = "flap";
      tile.textContent = " ";
      row.appendChild(tile);
      cells.push(tile);
    }
    board.appendChild(row);
  }

  /* Sound is synthesized locally. Quiet hours also silence timer chimes. */
  function unlock(done) {
    try {
      var API = window.AudioContext || window.webkitAudioContext;
      if (!API) { if (done) done(false); return; }
      audio = audio || new API();
      var source = audio.createBufferSource();
      source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
      source.connect(audio.destination);
      source.start(0);
      var result = audio.resume ? audio.resume() : null;
      if (result && result.then) result.then(function () { if (done) done(true); })
        .catch(function () { if (done) done(false); });
      else if (done) done(true);
    } catch (e) { if (done) done(false); }
  }
  function sound(chime, alarm) {
    var p = period(new Date().getHours());
    if (!audio || audio.state === "suspended" || document.hidden || (!alarm && p === "night") ||
        (!alarm && settings.volume === 0) || (alarm ? !alarmSettings.sound : (chime ? !settings.chime : !settings.sound))) return;
    try {
      var gain = audio.createGain();
      var volume = alarm ? Math.max(settings.volume, 0.25) : settings.volume * (p === "evening" ? 0.3 : 1);
      gain.connect(audio.destination);
      if (chime) {
        var tone = audio.createOscillator(), t = audio.currentTime;
        tone.type = "sine";
        tone.frequency.value = 660;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume * 0.35, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        tone.connect(gain);
        tone.start(t);
        tone.stop(t + 0.72);
      } else {
        var buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.045), audio.sampleRate);
        var samples = buffer.getChannelData(0);
        for (var i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 5);
        var source = audio.createBufferSource();
        source.buffer = buffer;
        gain.gain.value = volume;
        source.connect(gain);
        source.start(0);
      }
    } catch (e) {}
  }
  function cancelAnimation() {
    generation++;
    timers.forEach(function (timer) { clearTimeout(timer); });
    timers = [];
  }
  function accents(text, color) {
    var colors = [];
    for (var i = 0; i < 132; i++) {
      var row = Math.floor(i / 22), col = i % 22, on = false, hue = color;
      var canColor = text[i] === " " || "♥☺☻★☀☾⚡✓✦✌♪☕".indexOf(text[i]) >= 0;
      if (color && canColor) {
        if (settings.pattern === "corners") on = (row === 0 || row === 5) && (col === 0 || col === 21);
        if (settings.pattern === "border") on = row === 0 || row === 5 || col === 0 || col === 21;
        if (settings.pattern === "rainbow") { on = row === 0 || row === 5; hue = rainbow[Math.floor(col / 22 * 7)]; }
      }
      colors.push(on ? hue : "");
    }
    return colors;
  }
  function paint(lines, color, customColors, quiet, instant, label) {
    var text = frame(lines), colors = customColors || accents(text, color);
    var signature = colors.join(",");
    if (text === lastFrame && signature === lastColors) return;
    cancelAnimation();
    var mine = generation;
    board.setAttribute("aria-label", label || lines.join(" ").replace(/ +/g, " "));
    if (!quiet) sound(false);
    var speed = {slow:110, normal:62, quick:32}[settings.speed];
    cells.forEach(function (tile, i) {
      var symbols = {"♥":"heart", "☺":"smile", "☻":"smile", "★":"star", "☀":"sun", "☾":"moon", "⚡":"lightning", "✓":"check", "✦":"sparkle", "✌":"peace", "♪":"music", "☕":"coffee"};
      var cls = "flap" + (colors[i] ? " color-" + colors[i] : "") + (symbols[text[i]] ? " symbol-" + symbols[text[i]] : "");
      tile.className = cls;
      tile.style.animationDuration = Math.round(speed * 1.5) + "ms";
      if (instant || reduced() || text[i] === lastFrame[i]) { tile.textContent = text[i]; return; }
      var remaining = 3 + Math.floor(Math.random() * 5);
      function flip() {
        if (mine !== generation) return;
        remaining--;
        tile.className = cls;
        void tile.offsetWidth;
        tile.className = cls + " flip";
        tile.textContent = remaining ? chars[Math.floor(Math.random() * chars.length)] : text[i];
        if (remaining) timers.push(setTimeout(flip, speed));
      }
      timers.push(setTimeout(flip, (i % 22 * 11 + Math.floor(i / 22) * 33) * speed / 62));
    });
    lastFrame = text;
    lastColors = signature;
  }
  function choose(length, previous) {
    var n = Math.floor(Math.random() * length);
    return length > 1 && n === previous ? (n + 1 + Math.floor(Math.random() * (length - 1))) % length : n;
  }
  function clockLines(d) {
    var days = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
    var months = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    var time = (d.getHours() % 12 || 12) + ":" + ("0" + d.getMinutes()).slice(-2) + (d.getHours() < 12 ? " AM" : " PM");
    return ["", days[d.getDay()], months[d.getMonth()] + " " + d.getDate(), "", time, ""];
  }
  function withEmoji(lines, symbol) { var copy = lines.slice(); copy[5] = symbol; return copy; }
  function cleanMessage(value) {
    var text = String(value || "").replace(/\r/g, "").toUpperCase();
    var swaps = [[/❤️|❤|♥️|💕|💖/g,"♥"],[/😂|🤣/g,"☻"],[/😀|😃|😄|😁|🙂|😊|☺️/g,"☺"],[/⭐|🌟|★️/g,"★"],[/🌞|☀️/g,"☀"],[/🌙|🌜|🌛/g,"☾"],[/💪|🚀|🔥/g,"⚡"],[/👍|✅/g,"✓"],[/🎉|✨/g,"✦"],[/✌️/g,"✌"],[/🎵|🎶/g,"♪"],[/☕️/g,"☕"],[/[‘’]/g,"'"],[/[“”]/g,'"'],[/[–—]/g,"-"]];
    for (var i = 0; i < swaps.length; i++) text = text.replace(swaps[i][0], swaps[i][1]);
    try { if (text.normalize) text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return text.replace(/[^\x20-\x7E\n♥☺☻★☀☾⚡✓✦✌♪☕]/g, "").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function messageLines(value) {
    var text = cleanMessage(value), lines = [], paragraphs = text ? text.split("\n") : [];
    function addWords(words) {
      var line = "";
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        while (word.length > COLS) {
          if (line) { lines.push(line); line = ""; }
          lines.push(word.slice(0, COLS)); word = word.slice(COLS);
        }
        if (!word) continue;
        if (!line) line = word;
        else if (line.length + 1 + word.length <= COLS) line += " " + word;
        else { lines.push(line); line = word; }
      }
      if (line) lines.push(line);
    }
    for (var p = 0; p < paragraphs.length; p++) {
      if (!paragraphs[p].replace(/ /g, "")) lines.push("");
      else addWords(paragraphs[p].split(" "));
    }
    if (!text) return {error:"Type a message first.", lines:["","","YOUR MESSAGE HERE","","",""]};
    if (lines.length > ROWS) return {error:"This needs " + lines.length + " rows. Shorten it to 6 rows.", lines:["","MESSAGE TOO LONG","","SHORTEN YOUR WORDS","","BY " + (lines.length - ROWS) + " ROW(S)"]};
    var centered = ["","","","","",""];
    var top = Math.floor((ROWS - lines.length) / 2);
    for (var r = 0; r < lines.length; r++) centered[top + r] = lines[r];
    return {text:text, lines:centered};
  }
  function saveCustomMessages() {
    try { localStorage.setItem(customKey, JSON.stringify(customMessages)); return true; }
    catch (e) { return false; }
  }
  function availableMessages(p) {
    var builtIn = ORIGINAL_CONTENT[p + "Messages"].slice();
    return builtIn.concat(customMessages.anytime, customMessages[p]);
  }
  function nextScene(now) {
    var d = new Date(now), p = period(d.getHours());
    var special = ORIGINAL_CONTENT.specialDates[("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)];
    if (special && step % 4 === 0) { step++; return {lines:special, color:"green", seconds:30}; }
    var pattern = ["time","date","quote","time","quote"];
    if (settings.ambient !== "off") pattern.push("ambient");
    var type = pattern[step % pattern.length];
    step++;
    if (type === "ambient") { ambientUntil = 0; return {type:"ambient", seconds:12}; }
    if (type === "date") return {type:"date", lines:clockLines(d), seconds:12};
    if (type === "quote") {
      lastQuote = choose(ORIGINAL_CONTENT.inspirationalQuotes.length, lastQuote);
      return {lines:withEmoji(ORIGINAL_CONTENT.inspirationalQuotes[lastQuote], ["✓","⚡","☺","★","✓","☀"][lastQuote]), seconds:22};
    }
    var messages = availableMessages(p);
    lastMessage = choose(messages.length, lastMessage);
    var selected = messages[lastMessage];
    var messageIcons = {
      morning:["☕","☀","⚡","★","✓","☺"],
      afternoon:["⚡","✓","★","✦","♥","☺"],
      evening:["♪","☾","♥","✓","☕","☀"],
      night:["☾","☾","★","☾","⚡","☀"]
    };
    return {lines:selected.lines ? selected.lines : withEmoji(selected, messageIcons[p][lastMessage % messageIcons[p].length]), color:periodColors[p], seconds:24};
  }
  function ambient(now) {
    if (!ambientColors || now >= ambientUntil) {
      var palette = rainbow, month = new Date(now).getMonth();
      if (settings.ambient === "seasonal") {
        palette = month < 2 || month === 11 ? ["blue","white","purple"] :
          month < 5 ? ["green","yellow","purple"] : month < 8 ? ["blue","yellow","orange"] : ["orange","red","yellow"];
      }
      ambientColors = [];
      for (var i = 0; i < 132; i++) {
        var row = Math.floor(i / 22), col = i % 22, hue = palette[(row + Math.floor(col / 3) + ambientStep) % palette.length];
        if (settings.ambient === "wave") hue = Math.abs(row - (2.5 + Math.sin(col / 3 + ambientStep) * 2)) < 1.2 ? rainbow[(col + ambientStep) % 7] : "";
        if (settings.ambient === "checker") hue = (row + Math.floor(col / 2) + ambientStep) % 2 ? "blue" : "purple";
        if (settings.ambient === "diamond") hue = Math.abs(col - 10.5) + Math.abs(row - 2.5) * 2 < 7 ? rainbow[(row + ambientStep) % 7] : "";
        if (settings.ambient === "heart") {
          var heart = ["01100110","11111111","11111111","01111110","00111100","00011000"], x = col < 11 ? col - 2 : col - 12;
          hue = x >= 0 && x < 8 && heart[row][x] === "1" ? (col < 11 ? "red" : "purple") : "";
        }
        if (settings.ambient === "chase") {
          var edge = row === 0 || row === 5 || col === 0 || col === 21;
          var pos = row === 0 ? col : col === 21 ? 21 + row : row === 5 ? 47 - col : 52 - row;
          hue = edge ? ((pos - ambientStep * 3 + 5200) % 52 < 8 ? "white" : "blue") : "";
        }
        ambientColors.push(hue);
      }
      ambientStep++;
      ambientUntil = reduced() ? Infinity : now + 4000;
    }
    paint([], null, ambientColors, true, true, "Ambient color pattern");
  }
  function countdown(ms) {
    var seconds = Math.max(0, Math.ceil(ms / 1000));
    return ("0" + Math.floor(seconds / 60)).slice(-2) + ":" + ("0" + seconds % 60).slice(-2);
  }
  function timerChime(now, deadline) {
    /* Do not play missed alarms after waking a sleeping tablet. */
    if (now - deadline <= 10000) sound(true);
  }
  function dateStamp(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function alarmAllowed(d) {
    var day = d.getDay();
    return alarmSettings.repeat === "daily" || alarmSettings.repeat === "once" ||
      (alarmSettings.repeat === "weekdays" && day >= 1 && day <= 5) ||
      (alarmSettings.repeat === "weekends" && (day === 0 || day === 6));
  }
  function storeAlarm() {
    try { localStorage.setItem(alarmKey, JSON.stringify(alarmSettings)); return true; }
    catch (e) { return false; }
  }
  function triggerAlarm(now, preview) {
    var result = messageLines(alarmSettings.message || "GOOD MORNING");
    resetMode("alarm"); alarmActive = true; alarmChimeAt = 0;
    try { localStorage.removeItem(activeKey); } catch (e) {}
    override = {lines:result.error ? ["","ALARM","","TIME TO GET UP","","☀"] : result.lines};
    if (!preview) {
      alarmSettings.lastDate = dateStamp(new Date(now));
      if (alarmSettings.repeat === "once") alarmSettings.enabled = false;
      storeAlarm();
    }
    reveal(); tick();
  }
  function checkAlarm(now) {
    if (alarmActive) return;
    if (snoozeAt && now >= snoozeAt) { snoozeAt = 0; triggerAlarm(now, true); return; }
    if (!alarmSettings.enabled) return;
    var d = new Date(now), parts = alarmSettings.time.split(":"), due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(parts[0]), Number(parts[1]), 0, 0).getTime();
    var today = dateStamp(d);
    if (alarmAllowed(d) && alarmSettings.lastDate !== today && now >= due && now < due + 10 * 60000) triggerAlarm(now, false);
  }
  function tick() {
    var now = Date.now(), p = period(new Date(now).getHours());
    checkAlarm(now);
    board.style.opacity = settings.brightness / 100 * (p === "night" ? 0.58 : 1);
    if (mode === "override" && (!override || (override.expiresAt && now >= override.expiresAt))) {
      override = null;
      try { localStorage.removeItem(activeKey); } catch (e) {}
      normal(); return;
    }
    id("pause").disabled = mode === "override" || mode === "alarm";
    id("alarm-snooze").className = mode === "alarm" ? "" : "hidden";
    id("alarm-dismiss").className = mode === "alarm" ? "secondary" : "secondary hidden";
    if (paused) return;
    if (mode === "alarm") {
      paint(override.lines, "red", null, true, false, "Alarm: " + alarmSettings.message);
      if (now >= alarmChimeAt) { sound(true, true); alarmChimeAt = now + 12000; }
    } else if (mode === "override") {
      paint(override.lines, "white", null, false, false);
    } else if (mode === "focus") {
      if (focusPhase === "focus" && now >= focusEnd) {
        var boundary = focusEnd;
        focusPhase = "break";
        focusEnd += 5 * 60000;
        if (now < focusEnd) timerChime(now, boundary);
      }
      if (focusPhase === "break" && now >= focusEnd) {
        focusPhase = "done";
        timerChime(now, focusEnd);
      }
      if (focusPhase === "done") paint(["","SESSION COMPLETE","","NICE WORK","TAP FOR CONTROLS",""], "green", null, true, true);
      else paint(["",focusPhase === "focus" ? "FOCUS TIME" : "TAKE A BREAK","",countdown(focusEnd - now),focusPhase === "focus" ? "ONE THING AT A TIME" : "STRETCH AND RESET",""], focusPhase === "focus" ? "blue" : "green", null, true, true);
    } else if (mode === "breathing") {
      var elapsed = now - breathStart;
      if (elapsed >= 120000) { normal(); return; }
      var phase = elapsed % 10000;
      var inhale = phase < 4000;
      paint(["",inhale ? "BREATHE IN" : "BREATHE OUT","",String(Math.ceil(((inhale ? 4000 : 10000) - phase) / 1000)),"GENTLY AT YOUR PACE",""], "blue", null, true, true);
    } else if (mode === "ambient") {
      ambient(now);
    } else {
      if (!scene || now >= sceneUntil || lastPeriod !== p) {
        scene = nextScene(now);
        sceneUntil = now + scene.seconds * 1000;
      }
      if (scene.type === "ambient") ambient(now);
      else {
        if (scene.type === "date") scene.lines = clockLines(new Date(now));
        paint(scene.lines, scene.color, null, scene.type === "date", false);
      }
    }
    lastPeriod = p;
    id("mode-status").textContent = mode === "normal" ? "Daily messages" : mode === "alarm" ? "ALARM · Snooze or dismiss" : mode === "override" ? (override.expiresAt ? "Tablet message · " + countdown(override.expiresAt - now) + " left" : "Tablet message · until ended") : mode === "focus" ? "Focus session · " + focusPhase : mode === "breathing" ? "Two-minute breathing" : "Ambient colors";
  }
  function resetMode(next) {
    cancelAnimation();
    if (next !== "override" && next !== "alarm") {
      override = null;
      try { localStorage.removeItem(activeKey); } catch (e) {}
    }
    if (next !== "alarm") alarmActive = false;
    mode = next; paused = false; scene = null; sceneUntil = 0;
    lastFrame = ""; lastColors = ""; ambientUntil = 0; ambientColors = null;
    id("pause").textContent = "Pause";
  }
  function normal() { resetMode("normal"); tick(); }
  function pause() {
    if (mode === "override" || mode === "alarm") return;
    var now = Date.now();
    if (!paused) {
      tick();
      paused = true; pausedAt = now;
      pauseRemaining = Math.max(0, (mode === "focus" ? focusEnd : sceneUntil) - now);
      cancelAnimation();
      cells.forEach(function (tile, i) { tile.textContent = lastFrame[i] || " "; tile.className = tile.className.replace(" flip", ""); });
      id("pause").textContent = "Resume";
      id("mode-status").textContent = "Paused · tap Resume to continue";
    } else {
      paused = false;
      if (mode === "focus" && focusPhase !== "done") focusEnd = now + pauseRemaining;
      if (mode === "breathing") breathStart += now - pausedAt;
      if (mode === "normal") sceneUntil = now + pauseRemaining;
      if (isFinite(ambientUntil)) ambientUntil += now - pausedAt;
      lastPeriod = period(new Date(now).getHours());
      id("pause").textContent = "Pause";
      tick();
    }
    reveal();
  }
  function requestWake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request || wakePending || (wakeLock && !wakeLock.released)) return;
    wakePending = true;
    navigator.wakeLock.request("screen").then(function (lock) { wakeLock = lock; wakePending = false; })
      .catch(function () { wakePending = false; });
  }
  function hide() { id("toolbar").className = "board-toolbar faded"; }
  function reveal() {
    clearTimeout(hideTimer);
    id("toolbar").className = "board-toolbar";
    if (id("settings").className === "hidden") hideTimer = setTimeout(hide, 6000);
  }
  function start() {
    unlock(); requestWake();
    var root = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      var method = root.requestFullscreen || root.webkitRequestFullscreen;
      try { if (method) { var result = method.call(root); if (result && result.catch) result.catch(function () {}); } } catch (e) {}
    }
    reveal(); setTimeout(fit, 300);
  }
  function closeSettings() {
    id("settings").className = "hidden";
    id("settings-button").focus();
    reveal();
  }
  id("start").onclick = start;
  board.onclick = start;
  id("pause").onclick = pause;
  id("settings-button").onclick = function () {
    clearTimeout(hideTimer);
    id("toolbar").className = "board-toolbar";
    id("settings").className = "settings-overlay";
    id("close-settings").focus();
  };
  id("close-settings").onclick = closeSettings;
  id("normal").onclick = function () { normal(); closeSettings(); };
  id("focus").onclick = function () {
    unlock(); requestWake(); resetMode("focus");
    focusPhase = "focus"; focusEnd = Date.now() + 25 * 60000;
    tick(); closeSettings();
  };
  id("breathe").onclick = function () {
    requestWake(); resetMode("breathing"); breathStart = Date.now(); tick(); closeSettings();
  };
  id("ambient-mode").onclick = function () {
    requestWake(); resetMode("ambient"); tick(); closeSettings();
  };
  function describeAlarm() {
    if (!alarmSettings.enabled) return "Alarm is off.";
    var hour = Number(alarmSettings.time.slice(0, 2)), minute = alarmSettings.time.slice(3);
    var clock = (hour % 12 || 12) + ":" + minute + (hour < 12 ? " AM" : " PM");
    var repeats = {daily:"every day", weekdays:"on weekdays", weekends:"on weekends", once:"one time"};
    return "Alarm set for " + clock + " " + repeats[alarmSettings.repeat] + ".";
  }
  id("alarm-enabled").checked = alarmSettings.enabled;
  id("alarm-time").value = alarmSettings.time;
  id("alarm-repeat").value = alarmSettings.repeat;
  id("alarm-message").value = alarmSettings.message;
  id("alarm-sound").checked = alarmSettings.sound;
  id("alarm-status").textContent = describeAlarm();
  id("save-alarm").onclick = function () {
    var chosenTime = id("alarm-time").value;
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(chosenTime)) { id("alarm-status").textContent = "Choose a valid alarm time."; return; }
    alarmSettings.enabled = id("alarm-enabled").checked;
    alarmSettings.time = chosenTime;
    alarmSettings.repeat = id("alarm-repeat").value;
    alarmSettings.message = cleanMessage(id("alarm-message").value).slice(0, 80) || "GOOD MORNING";
    alarmSettings.sound = id("alarm-sound").checked;
    alarmSettings.lastDate = ""; snoozeAt = 0;
    id("alarm-message").value = alarmSettings.message;
    var remembered = storeAlarm();
    requestWake();
    unlock(function (ready) {
      id("alarm-status").textContent = remembered ? describeAlarm() + (ready ? " Saved and audio is armed." : " Saved. Tap Fullscreen / sound to arm audio.") : "Alarm applied, but this browser could not remember it.";
    });
  };
  id("test-alarm").onclick = function () {
    alarmSettings.message = cleanMessage(id("alarm-message").value).slice(0, 80) || "GOOD MORNING";
    alarmSettings.sound = id("alarm-sound").checked;
    unlock(); requestWake(); triggerAlarm(Date.now(), true); closeSettings();
  };
  id("alarm-snooze").onclick = function () {
    if (mode !== "alarm") return;
    snoozeAt = Date.now() + 5 * 60000; normal();
    id("mode-status").textContent = "Alarm snoozed for 5 minutes"; reveal();
  };
  id("alarm-dismiss").onclick = function () {
    if (mode !== "alarm") return;
    snoozeAt = 0; normal(); reveal();
  };
  function previewCustom() {
    var result = messageLines(id("custom-message").value);
    var preview = frame(result.lines), rows = [];
    for (var r = 0; r < ROWS; r++) rows.push(preview.slice(r * COLS, r * COLS + COLS));
    id("custom-preview").textContent = rows.join("\n");
    id("custom-fit").textContent = result.error || "Fits the board · 22 columns × 6 rows";
    return result;
  }
  function renderSavedMessages() {
    var holder = id("saved-messages");
    while (holder.firstChild) holder.removeChild(holder.firstChild);
    var labels = {anytime:"Any time", morning:"Morning", afternoon:"Afternoon", evening:"Evening", night:"Night"};
    var total = 0;
    for (var group in customMessages) {
      for (var i = 0; i < customMessages[group].length; i++) {
        total++;
        (function (periodName, index) {
          var item = customMessages[periodName][index];
          var box = document.createElement("div"), words = document.createElement("p");
          var load = document.createElement("button"), remove = document.createElement("button");
          box.className = "saved-message";
          words.textContent = labels[periodName] + ": " + item.text;
          load.type = "button"; load.className = "secondary"; load.textContent = "Load into editor";
          remove.type = "button"; remove.className = "secondary"; remove.textContent = "Delete";
          load.onclick = function () { id("custom-message").value = item.text; id("custom-period").value = periodName; previewCustom(); id("custom-message").focus(); };
          remove.onclick = function () {
            customMessages[periodName].splice(index, 1); saveCustomMessages(); sceneUntil = 0;
            id("custom-status").textContent = "Saved message deleted."; renderSavedMessages();
          };
          box.appendChild(words); box.appendChild(load); box.appendChild(remove); holder.appendChild(box);
        }(group, i));
      }
    }
    if (!total) {
      var empty = document.createElement("p"); empty.className = "hint";
      empty.textContent = "No personal messages saved yet."; holder.appendChild(empty);
    }
    id("clear-saved").disabled = !total;
  }
  id("custom-message").oninput = previewCustom;
  var symbolButtons = document.querySelectorAll("[data-symbol]");
  for (var symbolIndex = 0; symbolIndex < symbolButtons.length; symbolIndex++) symbolButtons[symbolIndex].onclick = function () {
    var box = id("custom-message"), startAt = typeof box.selectionStart === "number" ? box.selectionStart : box.value.length;
    var endAt = typeof box.selectionEnd === "number" ? box.selectionEnd : startAt;
    var symbol = this.getAttribute("data-symbol");
    box.value = box.value.slice(0, startAt) + symbol + box.value.slice(endAt);
    box.focus(); if (box.setSelectionRange) box.setSelectionRange(startAt + 1, startAt + 1); previewCustom();
  };
  id("show-custom").onclick = function () {
    var result = previewCustom();
    if (result.error) { id("custom-status").textContent = result.error; return; }
    var minutes = Number(id("custom-duration").value);
    unlock(); requestWake(); resetMode("override");
    override = {id:"local-" + Date.now(), text:result.text, lines:result.lines, expiresAt:minutes ? Date.now() + minutes * 60000 : 0};
    try { localStorage.setItem(activeKey, JSON.stringify(override)); } catch (e) {}
    tick(); id("custom-status").textContent = "Message is now on the board."; closeSettings();
  };
  id("end-custom").onclick = function () {
    normal(); id("custom-status").textContent = "The regular schedule is running."; closeSettings();
  };
  id("save-custom").onclick = function () {
    var result = previewCustom();
    if (result.error) { id("custom-status").textContent = result.error; return; }
    var group = id("custom-period").value;
    if (!customMessages[group]) group = "anytime";
    customMessages[group].push({id:"saved-" + Date.now() + "-" + Math.floor(Math.random() * 10000), text:result.text, lines:result.lines});
    if (saveCustomMessages()) id("custom-status").textContent = "Saved to the " + (group === "anytime" ? "any-time" : group) + " rotation.";
    else id("custom-status").textContent = "The browser could not save it permanently.";
    sceneUntil = 0; renderSavedMessages();
  };
  var clearArmed = false, clearArmTimer = null;
  id("clear-saved").onclick = function () {
    if (!clearArmed) {
      clearArmed = true; id("clear-saved").textContent = "Tap again to delete all";
      clearTimeout(clearArmTimer); clearArmTimer = setTimeout(function () { clearArmed = false; id("clear-saved").textContent = "Delete all saved messages"; }, 5000);
      return;
    }
    clearTimeout(clearArmTimer); clearArmed = false;
    customMessages = {anytime:[], morning:[], afternoon:[], evening:[], night:[]};
    saveCustomMessages(); sceneUntil = 0; id("clear-saved").textContent = "Delete all saved messages";
    id("custom-status").textContent = "All saved messages were deleted."; renderSavedMessages();
  };
  ["sound","chime"].forEach(function (name) { id(name).checked = settings[name]; });
  ["volume","brightness","pattern","speed","ambient"].forEach(function (name) { id(name).value = settings[name]; });
  function save() {
    ["sound","chime"].forEach(function (name) { settings[name] = id(name).checked; });
    settings.volume = clamp(Number(id("volume").value), 0, 0.4);
    settings.brightness = clamp(Number(id("brightness").value), 20, 100);
    ["pattern","speed","ambient"].forEach(function (name) { settings[name] = id(name).value; });
    try { localStorage.setItem("mini-board-preferences-v1", JSON.stringify(settings)); id("save-status").textContent = "Saved on this device."; }
    catch (e) { id("save-status").textContent = "Applied. This browser cannot remember settings."; }
    id("brightness-value").textContent = settings.brightness + "%";
    ambientUntil = 0; ambientColors = null;
    if (mode === "normal" && scene && scene.type === "ambient" && settings.ambient === "off") sceneUntil = 0;
    tick();
  }
  ["sound","chime","volume","brightness","pattern","speed","ambient"].forEach(function (name) { id(name).onchange = save; });
  id("brightness").oninput = save;
  id("brightness-value").textContent = settings.brightness + "%";
  id("test-sound").onclick = function () {
    unlock(function (ok) {
      if (!ok) { id("save-status").textContent = "Audio is unavailable in this browser."; return; }
      if (period(new Date().getHours()) === "night") id("save-status").textContent = "Quiet hours: sound is off until 6 AM.";
      else if (!settings.sound && !settings.chime) id("save-status").textContent = "Enable flap sound or the timer chime first.";
      else { sound(!settings.sound); id("save-status").textContent = "Test played. Check the tablet's media volume too."; }
    });
  };
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && id("settings").className !== "hidden") closeSettings();
    if (event.key === "Tab" && id("settings").className !== "hidden") {
      var controls = id("settings").querySelectorAll("button,input,select,textarea");
      var first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    } else if (event.key === "Tab") reveal();
  });
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", function () { setTimeout(fit, 150); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { fit(); requestWake(); tick(); }
  });
  var shift = 0;
  setInterval(function () {
    var positions = [[0,0],[1,0],[0,1],[-1,0],[0,-1]];
    shift = (shift + 1) % positions.length;
    board.style.marginLeft = positions[shift][0] + "px";
    board.style.marginTop = positions[shift][1] + "px";
  }, 300000);
  previewCustom(); renderSavedMessages();
  try {
    var activeSaved = JSON.parse(localStorage.getItem(activeKey));
    if (activeSaved && activeSaved.lines && (!activeSaved.expiresAt || activeSaved.expiresAt > Date.now())) {
      override = activeSaved; mode = "override";
    } else localStorage.removeItem(activeKey);
  } catch (e) {}
  fit(); tick(); reveal();
  setInterval(tick, 250);
  if (location.protocol === "file:") id("offline-status").textContent = "Local file: no internet needed.";
  else if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").then(function () { return navigator.serviceWorker.ready; })
      .then(function () { id("offline-status").textContent = "Offline copy ready. Reopen this same address in this browser."; })
      .catch(function () { id("offline-status").textContent = "Offline storage unavailable. This open display still works without internet."; });
  } else id("offline-status").textContent = "Offline reopening is not supported here. The open page still works offline.";
}())