# Esri World Imagery csempékből lombkorona-detektálás -> fapozíciók (lokális méter)
# A műholdképet csak elemzésre használjuk, textúraként nem.
param([double]$R = 450, [int]$Z = 18)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$lat0 = 47.6935; $lon0 = 17.6255
$mLat = 111320.0; $mLon = 111320.0 * [Math]::Cos($lat0 * [Math]::PI / 180)
$n = [Math]::Pow(2, $Z)
function TX($lon) { ($lon + 180) / 360 * $n }
function TY($lat) { $r = $lat * [Math]::PI / 180; (1 - [Math]::Log([Math]::Tan($r) + 1 / [Math]::Cos($r)) / [Math]::PI) / 2 * $n }
$x0 = [Math]::Floor((TX ($lon0 - $R / $mLon))); $x1 = [Math]::Floor((TX ($lon0 + $R / $mLon)))
$y0 = [Math]::Floor((TY ($lat0 + $R / $mLat))); $y1 = [Math]::Floor((TY ($lat0 - $R / $mLat)))
$dir = Join-Path $PSScriptRoot 'sat'; New-Item -ItemType Directory -Force $dir | Out-Null
$W = [int](($x1 - $x0 + 1) * 256); $Hh = [int](($y1 - $y0 + 1) * 256)
$bmp = New-Object System.Drawing.Bitmap $W, $Hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
for ($ty = $y0; $ty -le $y1; $ty++) { for ($tx = $x0; $tx -le $x1; $tx++) {
  $f = Join-Path $dir "$Z-$tx-$ty.jpg"
  if (-not (Test-Path $f)) { & curl.exe -sS --max-time 30 -o $f "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/$Z/$ty/$tx" }
  $img = [System.Drawing.Image]::FromFile($f); $g.DrawImage($img, [int](($tx - $x0) * 256), [int](($ty - $y0) * 256), 256, 256); $img.Dispose()
} }
$g.Dispose()
"mozaik: ${W}x${Hh} px, $(($x1-$x0+1)*($y1-$y0+1)) csempe"
# pixel -> lokális méter
function PX2M($px, $py) {
  $lon = ($x0 + $px / 256) / $n * 360 - 180
  $yy = $y0 + $py / 256; $lat = [Math]::Atan([Math]::Sinh([Math]::PI * (1 - 2 * $yy / $n))) * 180 / [Math]::PI
  @((($lon - $lon0) * $mLon), (-($lat - $lat0) * $mLat))
}
# gyors pixelolvasás
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $Hh
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$bytes = New-Object byte[] ($data.Stride * $Hh); [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$stride = $data.Stride; $bmp.UnlockBits($data)
Add-Type -TypeDefinition @"
public static class Canopy {
  // cella (c x c px) -> lombkorona-arány: sötét, zöldes, textúrált pixelek
  public static double[] Grid(byte[] b, int stride, int w, int h, int c) {
    int gw = w / c, gh = h / c; var res = new double[gw * gh];
    for (int gy = 0; gy < gh; gy++) for (int gx = 0; gx < gw; gx++) {
      int hit = 0, tot = 0; double sum = 0, sum2 = 0;
      for (int y = gy * c; y < gy * c + c; y++) for (int x = gx * c; x < gx * c + c; x++) {
        int i = y * stride + x * 3; int B = b[i], G = b[i + 1], R = b[i + 2];
        double L = (R + G + B) / 3.0; sum += L; sum2 += L * L; tot++;
        if (G >= R + 4 && G >= B + 2 && L < 105 && L > 18) hit++;
      }
      double mean = sum / tot, sd = System.Math.Sqrt(System.Math.Max(0, sum2 / tot - mean * mean));
      res[gy * gw + gx] = sd > 9 ? (double)hit / tot : (double)hit / tot * 0.4; // a sima gyep kevésbé textúrált
    }
    return res;
  }
}
"@
$C = 8  # ~3,2 m-es cellák z18-on
$grid = [Canopy]::Grid($bytes, $stride, $W, $Hh, $C)
$gw = [int][Math]::Floor($W / $C); $gh = [int][Math]::Floor($Hh / $C)
# fák elhelyezése: lombos cellákban, egymástól >= 5,5 m
$cells = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $grid.Length; $i++) { if ($grid[$i] -gt 0.5) { [void]$cells.Add($i) } }
$rnd = New-Object Random 7
$order = $cells | Sort-Object { $rnd.Next() }
$trees = New-Object System.Collections.ArrayList; $occ = @{}
foreach ($i in $order) {
  $gx = $i % $gw; $gy = [Math]::Floor($i / $gw)
  $m = PX2M (($gx + 0.5) * $C) (($gy + 0.5) * $C)
  if ([Math]::Abs($m[0]) -gt $R -or [Math]::Abs($m[1]) -gt $R) { continue }
  $kx = [Math]::Floor($m[0] / 5.5); $kz = [Math]::Floor($m[1] / 5.5); $ok = $true
  for ($a = -1; $a -le 1 -and $ok; $a++) { for ($b = -1; $b -le 1 -and $ok; $b++) {
    foreach ($q in @($occ["$($kx+$a),$($kz+$b)"])) { if ($q -and [Math]::Pow($q[0]-$m[0],2)+[Math]::Pow($q[1]-$m[1],2) -lt 30) { $ok = $false } } } }
  if (-not $ok) { continue }
  $k = "$kx,$kz"; if (-not $occ[$k]) { $occ[$k] = @() }; $occ[$k] += ,$m
  [void]$trees.Add([Math]::Round($m[0], 1)); [void]$trees.Add([Math]::Round($m[1], 1))
}
$bmp.Dispose()
$out = Join-Path $PSScriptRoot 'sattrees.json'
[IO.File]::WriteAllText($out, ($trees | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
"lombos cellák: $($cells.Count)  fák: $($trees.Count / 2)"
