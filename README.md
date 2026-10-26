# SZE kampusz 3D

Sétálható 3D modell a győri Széchenyi István Egyetem kampuszáról és környékéről, böngészőben (three.js).
Az alaprajzok, utak, folyók és fák az OpenStreetMapből származnak.

**Megnyitás:** `index.html` (önálló fájl, minden adat benne van; a three.js-t CDN-ről tölti).

## Irányítás

| Billentyű | |
|---|---|
| W A S D | mozgás |
| ← → / ↑ ↓ | forgás / fel-le nézés |
| Egér | körbenézés |
| Shift | futás |
| Space | ugrás, repülésben fel |
| C | repülésben le |
| F | repülés be/ki |
| L | épületnevek be/ki |
| M | kis/nagy térkép |
| Esc | menü (ugrás épületekhez, a vasúti kocsiba, az Üvegesbe) |

Egy pont linkelhető: `index.html#szélesség,hosszúság,irány[,dőlés,magasság]`
(a magasság a talaj fölött értendő, 3 m fölött repülő módban).

## Mi van benne

- Épületek OSM-alaprajzból, becsült magassággal (szintszám × 3,5 m oktatási, × 3,0 m egyéb).
  Lejtős telken a mélyebb oldalon szuterénszint bukkan ki.
- Procedurális homlokzatok épülettípusonként: az ablaküvegek tükrözik az eget, mögöttük
  perspektivikus „szobák” látszanak (interior mapping shader).
- Procedurális textúrák: fű, térkő, aszfalt, kerékpárút, tetők, lomb.
- Domborzat az OSM-lépcsők fokszámából (16 cm/fok); a lépcsők mentén a terep a lépcső lejtését követi.
- Fák: OSM + az Esri World Imagery műholdképén detektált lombkoronák helye (a kép nem textúra).
- **Vasúti kocsi:** a MÁV személykocsi, amely 1975 óta függőhíd a laborépületek és a központi épület
  között (OSM `w697438467`), a 2023-as felújítás utáni festéssel; belül bejárható.
- **Üveges:** üvegfalú pavilon teraszra nyíló ajtókkal, bejárható belső térrel (a berendezés jelképes).

## Felépítés

```
src/head.html   HTML, stílus, menü (az adat helyén __DATA__)
src/app.js      a teljes alkalmazás (three.js modul)
src/data.json   feldolgozott OSM-adat, domborzati minták, fák
tools/build.js  összefűzi a fentieket -> index.html
tools/sattrees.ps1  lombkorona-detektálás műholdképből (PowerShell)
```

Újraépítés: `node tools/build.js`

## Források, licencek

- Térképadat: © OpenStreetMap közreműködők, [ODbL](https://www.openstreetmap.org/copyright)
- A fák helyének detektálásához: Esri World Imagery (csak elemzés, nem kerül a modellbe)
- A vasúti kocsi festése és belseje a [MÁV-csoport 2023-as cikke](https://www.mavcsoport.hu/node/134085) fotói alapján készült (a fotók nincsenek a repóban)
- [three.js](https://threejs.org) 0.160.0 (MIT), CDN-ről
