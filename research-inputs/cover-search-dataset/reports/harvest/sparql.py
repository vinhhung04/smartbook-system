import json,sys,urllib.request,urllib.parse,time
UA="BookCoverRetrievalResearch/0.1 (non-commercial academic research script; low-volume)"
q=open(sys.argv[1],encoding='utf-8').read()
u="https://query.wikidata.org/sparql?"+urllib.parse.urlencode({"query":q,"format":"json"})
r=urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA,"Accept":"application/sparql-results+json"}),timeout=120)
d=json.load(r)
for b in d["results"]["bindings"]:
    print(json.dumps({k:v["value"] for k,v in b.items()},ensure_ascii=False))
