# 视觉规范 · 钢材质量缺陷归因与闭环处置平台

项目里的样式统一按这份规范执行。目标是工业大屏观感：深色底、高对比、信息密度高但不拥挤。

## 配色

```css
:root{
  --bg:#0E1B2E;         /* 页面背景 */
  --card:#142943;       /* 卡片背景 */
  --line:#1E3350;       /* 分隔线、边框 */
  --primary:#2FD4C4;    /* 主色青：关键数字、主因、正向指标 */
  --accent:#378ADD;     /* 辅助蓝：次要数据、图例第二位 */
  --text:#A8C0DC;       /* 正文 */
  --muted:#7E9BBE;      /* 次要文字、单位、说明 */
  --dim:#5A7391;        /* 未命中、禁用态 */
  --danger:#E24B4A;     /* 告警、严重等级 */
  --warn:#EF9F27;       /* 中等等级、效果不显著 */
  --ok:#639922;         /* 已解决状态 */
}
```

用法约定：

- 关键指标数字用 `--primary`，字号比标签大两级
- 图表配色序列固定为：`#2FD4C4` `#378ADD` `#EF9F27` `#E24B4A` `#7E9BBE` `#5A7391`
- 严重等级三档对应：轻微 `--muted`、中等 `--warn`、严重 `--danger`
- 不要引入规范外的颜色，不要用渐变、阴影、发光效果

## 字号与字重

| 用途 | 字号 | 字重 | 颜色 |
| --- | --- | --- | --- |
| 页面标题 | 18px | 500 | `--text` |
| 模块标题 | 14px | 500 | `--text` |
| 正文 | 13px | 400 | `--text` |
| 次要说明 | 12px | 400 | `--muted` |
| 指标数字 | 26px | 500 | `--primary` |
| 指标标签 | 12px | 400 | `--muted` |
| 表格表头 | 12px | 500 | `--muted` |
| 表格内容 | 13px | 400 | `--text` |

全站只用 400 和 500 两个字重，不要用 600 或 700。数字统一用等宽感的字体族，保证对齐。

## 间距与圆角

- 页面内边距 18px，卡片内边距 12px
- 卡片之间间距 12px，模块之间 16px
- 圆角：卡片 8px，按钮 6px，标签 4px
- 分隔线 1px `--line`，不要用 2px 以上

## 组件

### 指标卡

顶部常驻，一行四张，等宽。

```html
<div class="metric">
  <div class="metric-label">缺陷识别准确率</div>
  <div class="metric-value">94.44%</div>
  <div class="metric-note">NEU-DET 测试集 170/180</div>
</div>
```

```css
.metric{background:var(--card);border-radius:8px;padding:12px 14px}
.metric-label{font-size:12px;color:var(--muted)}
.metric-value{font-size:26px;font-weight:500;color:var(--primary);margin:4px 0 2px}
.metric-note{font-size:12px;color:var(--dim)}
```

### 内容卡

```css
.panel{background:var(--card);border-radius:8px;padding:12px 14px}
.panel-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:10px}
```

### 贡献度条形图

归因页核心组件，横向条形，右侧标注数值。

```css
.bar-track{height:14px;background:var(--line);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;background:var(--primary);border-radius:3px}
.bar-fill.secondary{background:var(--accent)}
.bar-row{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.bar-name{width:64px;font-size:12px;color:var(--muted);flex-shrink:0}
.bar-value{width:44px;text-align:right;font-size:12px;color:var(--primary)}
```

第一位用主色，第二位起用辅助色，未命中的维度显示空轨道和灰色 0。

### 表格

表头 12px `--muted`，内容 13px `--text`，行高 36px，隔行背景 `#12253D`。
「是否超标」列：超标用 `--danger`，正常用 `--dim`，不要只写文字不标色。

### 按钮

```css
.btn{padding:6px 14px;border-radius:6px;font-size:13px;border:1px solid var(--primary);color:var(--primary);background:transparent}
.btn-ghost{border-color:var(--line);color:var(--muted)}
.btn:hover{background:rgba(47,212,196,.08)}
```

主操作用主色描边，次操作用 ghost。不要用大面积实心色块。

### 告警条

```css
.alert{background:rgba(226,75,74,.12);border-left:3px solid var(--danger);
       padding:10px 14px;font-size:13px;color:var(--text);border-radius:4px}
```

### 状态标签

```css
.tag{padding:2px 8px;border-radius:4px;font-size:12px;display:inline-block}
.tag-pending{background:rgba(126,155,190,.16);color:var(--muted)}
.tag-doing{background:rgba(239,159,39,.16);color:var(--warn)}
.tag-done{background:rgba(99,153,34,.16);color:#97C459}
.tag-closed{background:rgba(90,115,145,.16);color:var(--dim)}
```

## 布局

- 顶部导航高度 48px，横向排列，当前项用 `--primary` 并加 2px 下边框
- 指标区一行四列，窄屏降为两列
- 检测工作台左 260px 右自适应，窄屏改为上下堆叠
- 图表区域自适应宽度，最小高度 200px

## 通用要求

- 所有页面配色、字号、间距必须一致，不要每个模块各写一套
- 补齐空状态（无数据时显示占位文案而非空白）和加载态（骨架或转圈）
- 窄屏下不出现横向滚动条
- 每个使用模拟数据或仿真结果的位置，就近用 12px `--dim` 文字标注来源
- 图表不要加 3D 效果、不要加阴影、图例放右侧或底部
