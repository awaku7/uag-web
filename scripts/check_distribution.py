"""Check that the Web wheel owns its UI and depends on the execution library."""

from email.parser import Parser
from pathlib import Path
from zipfile import ZipFile

wheel = next(Path("dist").glob("*.whl"))
with ZipFile(wheel) as archive:
    names = archive.namelist()
    assert "uag_web/static/index.html" in names
    assert "uag_web/static/assets/index.js" in names
    assert not any(name.startswith("uagent/") for name in names)
    metadata = Parser().parsestr(
        archive.read(
            next(name for name in names if name.endswith("/METADATA"))
        ).decode()
    )
    assert any(dep.startswith("uag[") for dep in metadata.get_all("Requires-Dist", []))
    entry_file = next(name for name in names if name.endswith("/entry_points.txt"))
    entry_points = archive.read(entry_file).decode()
    assert "uag-web = uag_web.server:main" in entry_points
    assert "uagw =" not in entry_points
    assert "uaga =" not in entry_points
print(f"Distribution checks passed: {wheel.name}")
