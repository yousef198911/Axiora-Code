import cairosvg, io, os, glob
from PIL import Image
S='branding/axiora-logo.svg'; R='vscodium/src/stable/resources'
def png(sz): return Image.open(io.BytesIO(cairosvg.svg2png(url=S,output_width=sz,output_height=sz))).convert('RGBA')
big=png(256)
ico_sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]
os.makedirs('branding/out',exist_ok=True)
big.save('branding/out/axiora.ico',sizes=ico_sizes)
# app ico + file-type icos (all replaced with brand icon to remove MS artwork)
for f in glob.glob(R+'/win32/*.ico'): big.save(f,sizes=ico_sizes)
png(70).save(R+'/win32/code_70x70.png'); png(150).save(R+'/win32/code_150x150.png')
png(512).save(R+'/linux/code.png'); png(192).save(R+'/server/code-192.png')
for s in (512,1024): png(s).save(f'branding/out/axiora-{s}.png')
open(R+'/linux/code.svg','w').write(open(S).read())
open('vscodium/src/stable/src/vs/workbench/browser/media/code-icon.svg','w').write(open(S).read())
for f in glob.glob(R+'/win32/inno-*.bmp'):
    w,h=Image.open(f).size
    bg=Image.new('RGB',(w,h),(255,255,255))
    if h>w*1.5: # big wizard image: gradient panel with logo
        top=(46,26,138); bot=(20,200,200)
        for y in range(h):
            t=y/h; c=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3))
            for x in range(w): bg.putpixel((x,y),c)
        l=png(int(w*0.8)); bg.paste(l,((w-l.width)//2,(h-l.height)//3),l)
    else:
        l=png(min(w,h)); bg.paste(l,((w-l.width)//2,(h-l.height)//2),l)
    bg.save(f)
# server/web
for f in glob.glob('vscodium/src/stable/**/*.png',recursive=True): print(f, Image.open(f).size)
