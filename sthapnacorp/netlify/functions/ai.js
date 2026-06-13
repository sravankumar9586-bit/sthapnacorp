exports.handler = async function(event, context) {
  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if(event.httpMethod !== 'POST'){
    return {statusCode: 405, body: 'Method Not Allowed'};
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log('API Key present:', !!apiKey);
    console.log('API Key prefix:', apiKey ? apiKey.substring(0,15) : 'MISSING');

    const body = JSON.parse(event.body);
    console.log('Request model:', body.model);
    console.log('Messages count:', body.messages?.length);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: body.max_tokens || 1000,
        messages: body.messages
      })
    });

    const data = await response.json();
    console.log('API response status:', response.status);
    console.log('API response type:', data.type);
    if(data.error) console.log('API error:', JSON.stringify(data.error));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };

  } catch(err) {
    console.log('Function error:', err.message);
    console.log('Stack:', err.stack);
    return {
      statusCode: 500,
      headers: {'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({error: err.message})
    };
  }
};
