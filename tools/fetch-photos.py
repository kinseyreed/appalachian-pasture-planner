#!/usr/bin/env python3
# Build data/species-photos.json: a cited lead photo per species from Wikipedia /
# Wikimedia Commons. Stdlib only. Species with no reliable image are skipped
# (the UI simply shows no photo for them).
import sys, json, time, urllib.parse, urllib.request

spj, outp = sys.argv[1], sys.argv[2]
UA = 'AppalachianPasturePlanner/1.0 (WVU academic tool; contact kyreed@mix.wvu.edu)'

def api(host, params):
    url = 'https://' + host + '/w/api.php?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def strip_html(s):
    import re
    return re.sub('<[^>]+>', '', s or '').strip()

sp = json.load(open(spj))
items = sp['species'] if isinstance(sp, dict) and 'species' in sp else sp

out = {}
for s in items:
    sid = s['id']
    sci = (s.get('scientificName') or '').replace('×', 'x')
    # use genus + species (first two tokens) for a stable Wikipedia title
    toks = [t for t in sci.split() if t and t[0].isalpha()]
    title = ' '.join(toks[:2]) if len(toks) >= 2 else sci
    try:
        # 1) page lead image filename + thumbnail
        q = api('en.wikipedia.org', {
            'action': 'query', 'titles': title, 'prop': 'pageimages',
            'piprop': 'thumbnail|name', 'pithumbsize': '480', 'redirects': '1', 'format': 'json'
        })
        pages = q.get('query', {}).get('pages', {})
        page = next(iter(pages.values()), {})
        thumb = (page.get('thumbnail') or {}).get('source')
        fname = page.get('pageimage')
        if not thumb or not fname:
            print('  no image:', sid, title, file=sys.stderr); continue
        # 2) Commons attribution for that file
        meta = api('en.wikipedia.org', {
            'action': 'query', 'titles': 'File:' + fname, 'prop': 'imageinfo',
            'iiprop': 'extmetadata|url', 'format': 'json'
        })
        mpages = meta.get('query', {}).get('pages', {})
        mp = next(iter(mpages.values()), {})
        info = (mp.get('imageinfo') or [{}])[0]
        em = info.get('extmetadata', {})
        artist = strip_html((em.get('Artist') or {}).get('value', ''))
        license_short = strip_html((em.get('LicenseShortName') or {}).get('value', ''))
        desc_url = info.get('descriptionurl', '')
        out[sid] = {
            'url': thumb,
            'credit': (artist or 'Wikimedia Commons'),
            'license': license_short,
            'source': desc_url or ('https://en.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'))),
            'title': title,
        }
        print('  ok:', sid, '->', title, '| by', (artist or '?')[:40], '|', license_short, file=sys.stderr)
    except Exception as e:
        print('  ERR:', sid, title, repr(e), file=sys.stderr)
    time.sleep(0.4)

json.dump({'_note': 'Lead photos from Wikipedia/Wikimedia Commons, with per-image credit + license. Rebuild with tools/fetch-photos.py.',
           'photos': out}, open(outp, 'w'), indent=1)
print('\nWROTE %s — %d/%d species have a photo' % (outp, len(out), len(items)), file=sys.stderr)
