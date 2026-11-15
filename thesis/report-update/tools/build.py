# -*- coding: utf-8 -*-
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from sbdoc import Doc
import edits_a, edits_b, edits_c, edits_d, post

src, out = sys.argv[1], sys.argv[2]
pages = json.load(open(sys.argv[3], encoding='utf-8')) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else {}
d = Doc(src)
for m in (edits_a, edits_b, edits_c, edits_d):
    m.run(d)
caps, keymap, changed = post.renumber(d)
print('keepNext set', post.keep_with_next(d))
ents = post.rebuild_lists(d, pages)
d.save(out)
json.dump([{k: e[k] for k in ('kind', 'anchor', 'parts', 'search')} for e in ents],
          open(os.path.join(os.path.dirname(__file__), 'entries.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('captions', len(caps), 'new keys', keymap)
print('renumbered', len(changed))
print('entries', len(ents))
