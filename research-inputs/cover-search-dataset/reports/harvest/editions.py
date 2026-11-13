import json,sys
sys.argv=['x']; exec(open('enrich.py',encoding='utf-8').read().split("r=[json.loads")[0])
r=[json.loads(l) for l in open('wd_cand.jsonl',encoding='utf-8')]
qids=list({x['work'].rsplit('/',1)[-1] for x in r})
out=[]
for i in range(0,len(qids),200):
    vals=" ".join("wd:"+q for q in qids[i:i+200])
    out+=sparql(f"""SELECT ?work ?ed ?edLabel ?img ?date WHERE {{ VALUES ?work {{ {vals} }}
      ?ed wdt:P629 ?work ; wdt:P18 ?img . OPTIONAL {{ ?ed wdt:P577 ?date }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }} }}""")
with open('wd_editions.jsonl','w',encoding='utf-8') as f:
    for x in out: f.write(json.dumps(x,ensure_ascii=False)+"\n")
print(len(out), len({x['work'] for x in out}))
