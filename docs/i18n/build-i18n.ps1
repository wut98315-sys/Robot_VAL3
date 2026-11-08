# 由 docs/i18n/hmi-strings.csv 生成各 HMI 页面的中英文切换脚本
# 用法：pwsh -File docs/i18n/build-i18n.ps1
# 说明：只翻译界面上的静态文字（innerHTML/placeholder），VAL3 运行时写入的内容（状态值、弹窗提示）不在此范围。

param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$csvPath = Join-Path $PSScriptRoot 'hmi-strings.csv'
$map = @{}
Import-Csv -Path $csvPath -Encoding UTF8 | ForEach-Object {
  $zh = $_.'中文'
  $en = $_.'English'
  if ($zh -and $en) { $map[$zh.Trim()] = $en.Trim() }
}
Write-Host "词条: $($map.Count)"

function Decode-Entities([string]$s) {
  $s = $s -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&nbsp;', ' '
  $s -replace '&amp;', '&'
}

function Get-Strings([string]$html) {
  $t = [regex]::Replace($html, '(?s)<script.*?</script>', '')
  $t = [regex]::Replace($t, '(?s)<style.*?</style>', '')
  $set = New-Object System.Collections.Generic.HashSet[string]
  foreach ($m in [regex]::Matches($t, '>([^<>]*[\u4e00-\u9fff][^<>]*)<')) {
    $s = (Decode-Entities $m.Groups[1].Value).Trim()
    if ($s) { [void]$set.Add($s) }
  }
  foreach ($m in [regex]::Matches($t, '(?:placeholder|value|title)="([^"]*[\u4e00-\u9fff][^"]*)"')) {
    $s = (Decode-Entities $m.Groups[1].Value).Trim()
    if ($s) { [void]$set.Add($s) }
  }
  $set
}

function To-JsonObj([hashtable]$h) {
  $parts = foreach ($k in $h.Keys) {
    $kk = $k.Replace('\', '\\').Replace('"', '\"')
    $vv = $h[$k].Replace('\', '\\').Replace('"', '\"')
    '"{0}":"{1}"' -f $kk, $vv
  }
  '{' + ($parts -join ',') + '}'
}

$js = @'
    <!-- i18n -->
    <script id="i18n-script" type="text/javascript">
(function () {
  var D = __DICT__;
  var K = 'hmiLang';
  function get() {
    try { var v = localStorage.getItem(K); if (v) { return v; } } catch (e) {}
    var m = document.cookie.match(/(?:^|;\s*)hmiLang=(\w+)/);
    return m ? m[1] : 'zh';
  }
  function set(v) {
    try { localStorage.setItem(K, v); } catch (e) {}
    document.cookie = K + '=' + v + ';path=/';
  }
  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
  function fit(el) {
    var orig = el.getAttribute('data-fs');
    var fs = parseFloat(orig);
    if (!fs) { try { fs = parseFloat(getComputedStyle(el).fontSize); } catch (e) {} }
    if (!fs) { fs = 13; }
    el.style.fontSize = fs + 'px';
    var guard = 0;
    while (guard < 12 && fs > 9 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      fs -= 1; el.style.fontSize = fs + 'px'; guard++;
    }
  }
  function apply(lang) {
    var els = document.getElementsByTagName('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.id === 'btnLang') { continue; }
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') { continue; }
      if (el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
        var t = trim(el.firstChild.nodeValue);
        var key = el.getAttribute('data-zh') || t;
        var en = D[key];
        if (en) {
          if (lang === 'en') {
            if (!el.getAttribute('data-zh')) {
              el.setAttribute('data-zh', t);
              el.setAttribute('data-fs', el.style.fontSize || '');
            }
            el.textContent = en;
            fit(el);
          } else {
            el.textContent = key;
            var fs0 = el.getAttribute('data-fs');
            if (fs0 !== null) { el.style.fontSize = fs0; }
          }
        }
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        var attrs = ['placeholder', 'value'];
        for (var a = 0; a < attrs.length; a++) {
          var v = el.getAttribute(attrs[a]);
          if (!v) { continue; }
          var e2 = D[trim(v)];
          if (!e2) { continue; }
          if (lang === 'en') {
            if (!el.getAttribute('data-zh-' + attrs[a])) { el.setAttribute('data-zh-' + attrs[a], v); }
            el.setAttribute(attrs[a], e2);
          } else {
            var z = el.getAttribute('data-zh-' + attrs[a]);
            if (z) { el.setAttribute(attrs[a], z); }
          }
        }
      }
    }
  }
  function syncBtn(lang) {
    var b = document.getElementById('btnLang');
    if (!b) { return; }
    b.textContent = (lang === 'en') ? '中' : 'EN';
    b.title = (lang === 'en') ? 'Switch to Chinese' : 'Switch to English';
    if (!b.getAttribute('data-bound')) {
      b.setAttribute('data-bound', '1');
      b.onclick = function () {
        var n = (get() === 'en') ? 'zh' : 'en';
        set(n); apply(n); syncBtn(n);
      };
    }
  }
  var L = get();
  apply(L); syncBtn(L);
  if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () { apply(L); syncBtn(L); });
  }
})();
    </script>
'@

$files = Get-ChildItem (Join-Path $Root 'HMI_cs9') -Recurse -Filter *.html |
  Where-Object { $_.Name -ne 'main.html' }
$count = 0
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $enc = New-Object System.Text.UTF8Encoding($false)
  $txt = $enc.GetString($bytes)
  if ($hasBom) { $txt = $txt.Substring(1) }

  $sub = @{}
  foreach ($s in (Get-Strings $txt)) { if ($map.ContainsKey($s)) { $sub[$s] = $map[$s] } }
  if ($sub.Count -eq 0) { continue }

  $block = $js.Replace('__DICT__', (To-JsonObj $sub))
  $txt = [regex]::Replace($txt, '(?s)[ \t]*<!-- i18n -->.*?</script>\s*', '')
  if ($txt -notmatch '</body>') { Write-Host "跳过(无 body): $($f.Name)"; continue }
  $txt = $txt -replace '</body>', ($block + "`r`n    </body>")

  $out = if ($hasBom) { (New-Object System.Text.UTF8Encoding($true)).GetBytes($txt) } else { $enc.GetBytes($txt) }
  [System.IO.File]::WriteAllBytes($f.FullName, $out)
  $count++
  Write-Host ("{0,-52} {1} 条" -f $f.FullName.Replace($Root + '\HMI_cs9\', ''), $sub.Count)
}
Write-Host "已处理 $count 个页面"
