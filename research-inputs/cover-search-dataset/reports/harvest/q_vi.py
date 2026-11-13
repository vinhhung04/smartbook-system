import json,sys
exec(open('enrich.py',encoding='utf-8').read().split("r=[json.loads")[0])
q="""SELECT ?work ?workLabel ?viLabel ?image ?date (GROUP_CONCAT(DISTINCT ?authorLabel;separator="; ") AS ?authors) ?clsLabel WHERE {
  { ?work wdt:P407 wd:Q9199 } UNION { ?work wdt:P495 wd:Q881 . ?work wdt:P31/wdt:P279? wd:Q7725634 } UNION { ?work wdt:P495 wd:Q881 . ?work wdt:P31 wd:Q571 }
  ?work wdt:P18 ?image .
  OPTIONAL { ?work wdt:P577 ?date } OPTIONAL { ?work wdt:P31 ?cls }
  OPTIONAL { ?work rdfs:label ?viLabel FILTER(LANG(?viLabel)="vi") }
  OPTIONAL { ?work wdt:P50 ?author . ?author rdfs:label ?authorLabel FILTER(LANG(?authorLabel)="vi") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "vi,en". }
} GROUP BY ?work ?workLabel ?viLabel ?image ?date ?clsLabel"""
for x in sparql(q): print(json.dumps(x,ensure_ascii=False))
