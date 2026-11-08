# HMI 中英文切换

## 用法

主页右上角的圆形按钮在 `EN` / `中` 之间切换，语言写入浏览器本地存储（`hmiLang`），
每次打开任意 HMI 页面都会自动套用。

## 改词条

1. 编辑 [hmi-strings.csv](hmi-strings.csv)：第一列是页面上的中文原文（**不要改**，它是匹配键），
   第二列是英文译文；英文留空则该条不翻译。
2. 重新生成各页面的词典：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File docs/i18n/build-i18n.ps1
```

脚本会把每个页面自己的词条写进该页面末尾的 `<script id="i18n-script">` 块里，
可以反复执行（幂等）。

## 覆盖范围

- 只翻译**页面里静态写死**的文字：标签、按钮、表头、占位符、下拉框选项文字。
- 不翻译 VAL3 运行时写入的内容：状态值、`userPageBind` 绑定的实时数据、
  `popUpMsg` / `userPageAlert` / `userPageConfirm` 弹窗（这些在 `.pgx` 里）。
- 英文通常比中文长，脚本会自动按容器宽度/高度缩小字号（最小 9px）以避免溢出；
  个别位置如果仍然拥挤，直接在这张表里换更短的英文即可。

## 新增页面

新页面只要按旧样式写好中文，运行一次 `build-i18n.ps1` 就会自动注入脚本；
若页面里出现表里没有的新中文，脚本会忽略它（保持中文），把它补进 CSV 再跑一次即可。
