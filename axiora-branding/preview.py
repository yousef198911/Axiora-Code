import json,cairosvg,html
T='vscodium/src/stable/extensions/theme-axiora/themes/'
for typ in ('dark','light'):
  t=json.load(open(T+f'axiora-{typ}.json')); c=t['colors']
  tk={s['scope'][0]:s['settings']['foreground'] for s in t['tokenColors']}
  K,S,N,F,TY,CM,P,FG=tk['keyword'],tk['string'],tk['constant.numeric'],tk['entity.name.function'],tk['entity.name.type'],tk['comment'],tk['punctuation'],c['editor.foreground']
  code=[[(CM,'// Axiora-Code — '+t['name'])],
   [(K,'import '),(P,'{ '),(TY,'Editor'),(P,' } '),(K,'from '),(S,"'./core'"),(P,';')],[],
   [(K,'export class '),(TY,'Workspace '),(P,'{')],
   [(FG,'  '),(K,'private '),(FG,'files'),(P,': '),(TY,'string'),(P,'[] = [];')],
   [(FG,'  '),(F,'open'),(P,'('),(tk['variable.parameter'],'path'),(P,': '),(TY,'string'),(P,') {')],
   [(FG,'    '),(K,'const '),(FG,'limit '),(P,'= '),(N,'42'),(P,';')],
   [(FG,'    '),(K,'if '),(P,'('),(K,'this'),(P,'.'),(FG,'files'),(P,'.'),(FG,'length '),(P,'< '),(FG,'limit'),(P,') {')],
   [(FG,'      '),(K,'this'),(P,'.'),(FG,'files'),(P,'.'),(F,'push'),(P,'('),(tk['variable.parameter'],'path'),(P,');')],
   [(FG,'    '),(P,'}')],[(FG,'    '),(K,'return '),(S,'`Opened ${path}`'),(P,';')],[(FG,'  '),(P,'}')],[(P,'}')]]
  W,H=1280,760; o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="DejaVu Sans Mono, monospace">']
  r=lambda x,y,w,h,f:o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f[:7]}"/>')
  tx=lambda x,y,s,f,sz=13,fam='':o.append(f'<text x="{x}" y="{y}" fill="{f[:7]}" font-size="{sz}" {fam}>{html.escape(s)}</text>')
  r(0,0,W,H,c['editor.background']); r(0,0,W,32,c['titleBar.activeBackground']); tx(W/2-70,21,'Axiora-Code — app.ts',c['titleBar.activeForeground'],12,'font-family="DejaVu Sans"')
  for i,(x,col) in enumerate([(14,'#FF6B6B'),(32,'#F7C948'),(50,'#4ADE80')]): o.append(f'<circle cx="{x}" cy="16" r="5" fill="{col}"/>')
  r(0,32,48,H-56,c['activityBar.background'])
  for i in range(5):
    col=c['activityBar.foreground'] if i==0 else c['activityBar.inactiveForeground']; o.append(f'<rect x="14" y="{48+i*44}" width="20" height="20" rx="4" fill="none" stroke="{col[:7]}" stroke-width="2"/>')
  r(0,48,2,20,c['activityBar.foreground'])
  r(48,32,240,H-56,c['sideBar.background']); r(287,32,1,H-56,c['sideBar.border'])
  tx(62,54,'EXPLORER',c['activityBar.inactiveForeground'],11,'font-family="DejaVu Sans"')
  files=['▾ AXIORA-PROJECT','  ▾ src','     app.ts','     core.ts','     theme.css','  README.md','  package.json']
  for i,f in enumerate(files):
    y=80+i*24
    if 'app.ts' in f: r(48,y-16,240,22,c['list.activeSelectionBackground'])
    tx(62,y,f,c['sideBar.foreground'],13,'font-family="DejaVu Sans"')
  r(288,32,W-288,36,c['editorGroupHeader.tabsBackground'])
  r(288,32,130,36,c['tab.activeBackground']); r(288,32,130,2,c['tab.activeBorderTop']); tx(304,55,'app.ts',c['tab.activeForeground'],13,'font-family="DejaVu Sans"')
  tx(440,55,'core.ts',c['tab.inactiveForeground'],13,'font-family="DejaVu Sans"')
  r(288,68+5*22+8,W-288,22,c['editor.lineHighlightBackground'])
  for i,line in enumerate(code):
    y=90+i*22; tx(300,y,f'{i+1:>3}',c['editorLineNumber.activeForeground'] if i==5 else c['editorLineNumber.foreground'])
    s=''.join(f'<tspan fill="{col[:7]}">{html.escape(w).replace(" ","&#160;")}</tspan>' for col,w in line); o.append(f'<text x="350" y="{y}" font-size="14">{s}</text>')
  py=H-24-190; r(288,py,W-288,190,c['panel.background']); r(288,py,W-288,1,c['panel.border'])
  tx(304,py+24,'TERMINAL',c['tab.activeForeground'],11,'font-family="DejaVu Sans"'); r(304,py+30,62,1,c['tab.activeBorderTop'])
  tx(304,py+58,'$ npm run build',FG); tx(304,py+80,'✓ Compiled successfully in 1.8s',S)
  r(0,H-24,W,24,c['statusBar.background']); tx(12,H-8,'⎇ main   ✓ 0  ⚠ 0',c['statusBar.foreground'],12,'font-family="DejaVu Sans"'); tx(W-260,H-8,'Ln 6, Col 12   UTF-8   TypeScript',c['statusBar.foreground'],12,'font-family="DejaVu Sans"')
  o.append('</svg>'); cairosvg.svg2png(bytestring=''.join(o).encode(),write_to=f'theme-{typ}-preview.png')
