import base64
import os
D=os.path.dirname(os.path.abspath(__file__))+'/'; S=D+'../static/'
logo='data:image/png;base64,'+base64.b64encode(open(S+'logo.png','rb').read()).decode()
def sc(t): return '<script>\n'+t.replace('</script','<\\/script')+'\n</script>\n'
html=f'''<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sistema Médico ISIM — Demostración</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>{open(S+'styles.css').read()}</style></head>
<body><div id="app"></div><div id="modal-root"></div><div id="toast"></div>
{sc('window.DEMO_LOGO="'+logo+'";')}{sc(open(S+'cie10.js').read())}{sc(open(D+'seed.js').read())}{sc(open(D+'seed_ci.js').read())}{sc(open(D+'mock.js').read())}{sc(open(S+'app.js').read())}
</body></html>'''
open(D+'index.html','w').write(html); print(len(html))
