import json,re,sys,urllib.parse,urllib.request,time
UA="BookCoverRetrievalResearch/0.1 (non-commercial academic research script; low-volume)"
def sparql(q):
    u="https://query.wikidata.org/sparql"
    data=urllib.parse.urlencode({"query":q}).encode()
    for a in range(4):
        try:
            r=urllib.request.urlopen(urllib.request.Request(u,data=data,headers={"User-Agent":UA,"Accept":"application/sparql-results+json"}),timeout=120)
            time.sleep(2); return [{k:v["value"] for k,v in b.items()} for b in json.load(r)["results"]["bindings"]]
        except Exception as e: print("retry",e,file=sys.stderr); time.sleep(15)
    return []
r=[json.loads(l) for l in open('wd_lit.jsonl',encoding='utf-8')]
pick={}
for x in r:
    n=urllib.parse.unquote(x['image'].rsplit('/',1)[-1])
    if re.search(r'cover|jacket|first.?edition|1st.?ed|front|binding|bìa', n, re.I) and not re.search(r'title.?page|frontis|front.?page|frontespi', n, re.I):
        pick.setdefault(x['work'].rsplit('/',1)[-1],x)
qids=list(pick); print(len(qids),file=sys.stderr)
out=[]
for i in range(0,len(qids),150):
    vals=" ".join("wd:"+q for q in qids[i:i+150])
    q=f"""SELECT ?work ?workLabel ?image ?date (GROUP_CONCAT(DISTINCT ?authorLabel;separator="; ") AS ?authors)
      (GROUP_CONCAT(DISTINCT ?langCode;separator=",") AS ?langs) (SAMPLE(?ptitle) AS ?printed_title) (SAMPLE(?pubLabel) AS ?publisher) (SAMPLE(?cc) AS ?commonscat) WHERE {{
      VALUES ?work {{ {vals} }}
      ?work wdt:P18 ?image . OPTIONAL {{ ?work wdt:P577 ?date }}
      OPTIONAL {{ ?work wdt:P50 ?author . ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel)="en") }}
      OPTIONAL {{ ?work wdt:P407 ?lang . ?lang wdt:P218 ?langCode }}
      OPTIONAL {{ ?work wdt:P1476 ?ptitle }}
      OPTIONAL {{ ?work wdt:P123 ?pub . ?pub rdfs:label ?pubLabel . FILTER(LANG(?pubLabel)="en") }}
      OPTIONAL {{ ?work wdt:P373 ?cc }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }} GROUP BY ?work ?workLabel ?image ?date"""
    out+=sparql(q); print(i,len(out),file=sys.stderr)
with open('wd_cand.jsonl','w',encoding='utf-8') as f:
    for x in out: f.write(json.dumps(x,ensure_ascii=False)+"\n")
