const API_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";

const auth = Deno.env.get("AUTH")

const headers = { 
  "content-type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Request-Context,api-supported-versions,Content-Length,Date,Server",
};

function sleep(duration) {
  return new Promise((res, rej) => {
    setTimeout(() => {
      res(true);
    }, duration * 1000);
  });
}

function _parseProp(
  search: Record<string, any>,
  proplist: Record<string, any>[]
): any {
  const props = proplist.filter((i) =>
    Object.entries(search).every(([key, value]) => i.urn[key] === value)
  );

  if (props.length > 0) {
    const prop = props[0];
    return prop.value[Object.keys(prop.value)[0]];
  }
}

async function getIUPACCompounds(url: string) {
  try {
    let res = await (
      await fetch(url)
    ).json();
    while (res.Waiting) {
      await sleep(2);
      res = await (
        await fetch(
          [API_BASE, "listkey", res.Waiting.ListKey, "JSON"].join("/")
        )
      ).json();
    }
    if (!(res.PC_Compounds instanceof Array)) {
      return null;
    }
    const compounds = res.PC_Compounds.map((item) => ({
      cid: item?.id?.id?.cid,
      iupac_name: _parseProp(
        { label: "IUPAC Name", name: "Preferred" },
        item["props"]
      ),
      molecular_formula: _parseProp(
        { label: "Molecular Formula" },
        item["props"]
      ),
    }));
    return compounds;
  } catch (err) {
    return null;
  }
}

function isFormula(name: string): boolean {
  return name.split("").some((i) => i.toUpperCase() === i);
}

async function handleIUPAC(name) {
  const kv = await Deno.openKv();
  const cache = await kv.get(["IUPAC", name?.trim()]);
  if (cache && cache.value) {
    return new Response(`{"data": "${cache.value}", "message": "cache"}`, {headers});
  }
  const firstNameSpace = "name"; // isFormula(name) ? "formula" : "name";
  let res = await getIUPACCompounds(
    [API_BASE, firstNameSpace, name, "JSON"].join("/")
  );
  if (!res) { // && firstNameSpace === "formula") {
    res = await getIUPACCompounds([API_BASE, "name", name, "JSON"].join("/"));
  }

  const values = res?.filter((item) => item.iupac_name) || [];
  const result = (values[0] && values[0].iupac_name);
  if (result) {
    await kv.set(["IUPAC", name?.trim()], result);
  }
  return new Response(`{"data": "${result || name}", "message": "${result? "fetch successfully" : "result is none, return original name"}"}`, {headers});
}

async function handleCHEBI(name) {
  const kv = await Deno.openKv();
  const cache = await kv.get(["CHEBI", name?.trim()]);
  if (cache && cache.value) {
    return new Response(`{"data": "${cache.value}", "message": "cache"}`, {headers});
  }
  const url = `https://www.ebi.ac.uk/spot/zooma/v2/api/services/annotate?propertyValue=${name}&filter=required:[chebi],preferred:[chebi]`;
  let result = "";
  try{
    let res = await (
      await fetch(url)
    ).json();
    const temp = res.find(item => item.semanticTags.some(item2 => item2.includes("CHEBI")));
    const tag = temp.semanticTags[0].match(/(CHEBI_\d+)/g).join("");
    result = tag;
  } catch(err) {
    console.error(url, err);
  }
  if (result) {
    await kv.set(["CHEBI", name?.trim()], result);
  }
  return new Response(`{"data": "${result || name}", "message": "${result? "fetch successfully" : "result is none, return original name"}"}`, {headers});
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname = "", search = "" } = url;
  console.log({ pathname, search });
  const items =
    (search.startsWith("?") &&
      search
        .slice(1)
        .split("&")
        .map((item) => item.split("="))) ||
    [];
  const name = items.find((item) => item[0] === "name");
  //   const space = items.find((item) => item[0] === "space");
  if (!name) {
    return new Response(`{"error": "no name or space"}`, {headers});
  }
  

  if (pathname === "/iupac") {
    return await handleIUPAC(name[1]);
  } else if (pathname === "/chebi") {
    return await handleCHEBI(name[1])
  } else if (pathname === "/clear" && search.startsWith(`?auth=${auth}`)) {
    const kv = await Deno.openKv();
    const iter = kv.list<string>({ prefix: [name[1]] });
    for await (const res of iter) kv.delete(res.key);
    return new Response(`{"message": "KV ${name[1]} cleared"}`, {headers});
  } else {
    return new Response(`{"error": "path 'name' error"}`, {headers});
  }

  //   return new Response("Error, no name or space")
}

Deno.serve((req: Request) => handler(req));
