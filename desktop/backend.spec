from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

root = Path(SPECPATH).parent
datas = []
# Ship only source resources. Never bundle data/, .env, logs, or user content.
for directory in ('config', 'prompts', 'skills'):
    for item in (root / directory).rglob('*'):
        if item.is_file() and '__pycache__' not in item.parts and item.suffix not in ('.pyc', '.pyo'):
            datas.append((str(item), str(item.parent.relative_to(root))))
datas.append((str(root / 'frontend' / 'dist'), 'frontend/dist'))
# Agent/prompt discovery uses importlib and filesystem enumeration.
hidden = []
for directory in ('agents', 'apis', 'utils', 'services', 'workflows', 'prompts', 'config'):
    for item in (root / directory).rglob('*.py'):
        module = '.'.join(item.relative_to(root).with_suffix('').parts)
        hidden.append(module.removesuffix('.__init__'))
        datas.append((str(item), str(item.parent.relative_to(root))))
for distribution in ('uvicorn', 'pydantic', 'langchain', 'langchain-core', 'langchain-community',
                     'langsmith', 'zhipuai', 'dashscope', 'marshmallow'):
    datas += copy_metadata(distribution)
hidden += ['main', 'uvicorn.logging', 'uvicorn.loops.asyncio', 'uvicorn.protocols.http.h11_impl',
           'uvicorn.protocols.websockets.websockets_impl', 'uvicorn.lifespan.on',
           'passlib.handlers.argon2', 'argon2', '_cffi_backend']
hidden += collect_submodules('asyncpg')
a = Analysis([str(root / 'desktop' / 'backend.py')], pathex=[str(root)],
             binaries=[], datas=datas, hiddenimports=hidden, hookspath=[], runtime_hooks=[],
             excludes=['pytest', 'IPython', 'tkinter', 'matplotlib', 'torch', 'tensorflow'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='juben-backend',
          debug=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='juben-backend')
