import json,sys,time,urllib.request,urllib.parse,urllib.error
UA="BookCoverRetrievalResearch/0.1 (non-commercial academic research script; low-volume)"
def api(**p):
    p.update(format="json",formatversion="2")
    u="https://commons.wikimedia.org/w/api.php?"+urllib.parse.urlencode(p)
    for a in range(8):
        try:
            r=urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=60); time.sleep(2.5); return json.load(r)
        except urllib.error.HTTPError as e:
            ra=e.headers.get("Retry-After"); w=int(ra) if ra and ra.isdigit() else 30*(a+1); print("backoff",e.code,w,file=sys.stderr,flush=True); time.sleep(w)
        except Exception as e: time.sleep(10)
    return {}
r=[json.loads(l) for l in open('wd_cand.jsonl',encoding='utf-8')]
done=set()
try:
    for l in open('cat_files.jsonl',encoding='utf-8'): done.add(json.loads(l)['work'])
except FileNotFoundError: pass
todo=[x for x in r if x.get('commonscat') and 'en' in x.get('langs','') and x.get('authors') and x['work'] not in done]
print(len(todo),file=sys.stderr,flush=True)
with open('cat_files.jsonl','a',encoding='utf-8') as f:
    for i,x in enumerate(todo):
        d=api(action="query",list="categorymembers",cmtitle="Category:"+x['commonscat'],cmtype="file|subcat",cmlimit="200")
        m=[c["title"] for c in d.get("query",{}).get("categorymembers",[])]
        f.write(json.dumps({"work":x['work'],"commonscat":x['commonscat'],"members":m},ensure_ascii=False)+"\n"); f.flush()
        if i%20==0: print(i,file=sys.stderr,flush=True)
