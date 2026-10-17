const worker = {
  async fetch(request: Request) {
    const url = new URL(request.url);

    return Response.json({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body: await request.text(),
    });
  },
};

export default worker;
