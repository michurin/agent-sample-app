'use strict';

const util = require('util');
const request = require('request');
const config = require('../config/config');
const transcript = require('../chats/transcript.json');

const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION,
    credentials: new AWS.Credentials(
        process.env.AWS_ACCESS_KEY_ID,
        process.env.AWS_SECRET_ACCESS_KEY,
        null
    )
});

const lexruntime = new AWS.LexRuntime();

const params = {  // TODO: bad idea to make it global
    botAlias:          process.env.LEX_BOT_ALIAS,
    botName:           process.env.LEX_BOT_NAME,
    inputText:         'init',
    userId:            '12345',
    sessionAttributes: {
//              someKey: 'STRING_VALUE',
    },
};

function getNextPingURL(linkArr) {
    for (let i = 0; i < linkArr.length; i++) {
        const link = linkArr[i];
        if (link['@rel'] === 'next') {
            return link['@href'].replace('/events', '/events.json');
        }
    }
}

function LexToLP(lex_resp) {
    /* Have to convert from

    {
        "dialogState": "ElicitSlot",
        "intentName": "Tariff",
        "message": "What city?",
        "messageFormat": "PlainText",
        "responseCard": {
            "contentType": "application/vnd.amazonaws.card.generic",
            "genericAttachments": [
                {
                    "attachmentLinkUrl": null,
                    "buttons": [
                        {
                            "text": "Tel Aviv",
                            "value": "Tel Aviv"
                        },
                        {
                            "text": "Moscow",
                            "value": "Moscow"
                        },
                        {
                            "text": "London",
                            "value": "London"
                        }
                    ],
                    "imageUrl": null,
                    "subTitle": null,
                    "title": null
                }
            ],
            "version": "1"
        },
        "sessionAttributes": {},
        "slotToElicit": "city",
        "slots": {
            "city": "",
            "class": ""
        }
    }

    To:

    {
        "@type": "line",
        "json": {
            "elements": [
                {
                    "text": "text here!",
                    "type": "text"
                },
                {
                    "click": {
                        "actions": [
                            {
                                "text": "img",
                                "type": "publishText"
                            }
                        ],
                        "metadata": [
                            {
                                "id": "12345",
                                "type": "ExternalId"
                            }
                        ]
                    },
                    "style": {
                        "background-color": "#0000cc",
                        "bold": true,
                        "color": "#ffffff",
                        "italic": false,
                        "size": "small"
                    },
                    "title": "say img",
                    "type": "button"
                }
            ],
            "type": "vertical"
        },
        "text": "ignored but must exists",
        "textType": "rich-content"
    }

    */

    var elements = [
        {
            'text': lex_resp.message,
            'type': 'text'
        },
    ]
    console.log(`Lex responseCard = ${lex_resp.responseCard}`)
    if (lex_resp.responseCard) {
        console.log('Adding buttons');
        elements = elements.concat(lex_resp.responseCard.genericAttachments[0].buttons.map((b) => {
            console.log(`Add button ${b.text}`)
            return {
                'click': {
                    'actions': [
                        {
                            'text': 'aws ' + b.value,
                            'type': 'publishText'
                        }
                    ],
                    'metadata': [ // ???
                        {
                            'id': '12345',
                            'type': 'ExternalId'
                        }
                    ]
                },
                'style': {
                    'background-color': '#0000cc',
                    'bold': true,
                    'color': '#ffffff',
                    'italic': false,
                    'size': 'small'
                },
                'title': b.text,
                'type': 'button'
            }
        }));
    }
    return {
        '@type': 'line',
        'json': {
            'elements': elements,
            'type': 'vertical'
        },
        'text': 'ignored but must exists',
        'textType': 'rich-content'
    }}


class AgentChat {
    constructor(session, chatURL) {
        this.session = session;
        this.chatURL = chatURL;
        this.lineIndex = 0;
        this.chatPingInterval = 2000;
    }

    start(callback) {
        this.startChatSession((err, data) => {
            if (err) {
                callback(err);
            }
            else {
                callback(null);
                this.chatLink = data.chatLink;
                this.chatPolling();
            }
        });
    }

    startChatSession(callback) {
        console.log(`(startChatSession) In linkForNextChat: ${this.chatURL}`);

        const options = {
            method: 'POST',
            url: `${this.chatURL}.json?v=1&NC=true`,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true,
            body: {'chat': 'start'}
        };

        request(options, (error, response, body) => {
            if (error) {
                callback(`Failed to start chat session with error: ${JSON.stringify(error)}`);
            }
            else if(response.statusCode < 200 || response.statusCode > 299){
                callback(`Failed o start chat session with error: ${JSON.stringify(body)}`);
            }
            // TODO: We MUST to ckeck here body.error!
            //console.log(`Start chat session - body: ${body.chatLocation.link['@href']}`);
            console.log(`Start chat session - body.chatLocation: ${body.chatLocation}`);
            Object.keys(body).forEach(function(key, index) {
                console.log(`Key: ${key}`);
                console.log(`Val: ${JSON.stringify(body[key])}`);
            });
            callback(null, {
                chatLink: body.chatLocation.link['@href']
            });
        });
    }

    chatPolling(url) {
        if (!url) {
            url = this.chatLink + '.json?v=1&NC=true'
        }

        const options = {
            method: 'GET',
            url: url,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json:true
        };

        request(options, (error, response, body)=> {
            if (error) {
                console.error(`Agent polling failed. Error: ${JSON.stringify(error)}`);
                process.exit(2);
                return;
            }
            else if(response.statusCode < 200 || response.statusCode > 299){
                console.error(`Agent polling failed. body: ${JSON.stringify(body)}`);
                process.exit(3);
                return;
            }
            let events;
            let nextURL;

            if (body.chat && body.chat.error) {
                console.log(`Chat error: ${JSON.stringify(body.chat.error)}`);
                return;
            }

            if (body.chat && body.chat.events) {
                nextURL = `${getNextPingURL(body.chat.events.link)}&v=1&NC=true`;
                events = body.chat['events']['event'];
            }
            else {
                try {
                    nextURL = `${getNextPingURL(body.events.link)}&v=1&NC=true`;
                }
                catch (e) {
                    console.log(`Error getting the next URL link: ${e.message}, body=${JSON.stringify(body)}`);
                    return;
                }
                events = body['events']['event'];
            }

            if (events) {
                if (!Array.isArray(events)) { // The API send an object and not an array if there is 1 event only
                    events = [events];
                }
                for (let i = 0; i < events.length; i++) {
                    const ev = events[i];

                    if ((ev['@type'] === 'state') && (ev.state === 'ended')) {
                        return;
                    }
                    else if ((ev['@type'] === 'line') && (ev['source'] === 'visitor')) {
                        console.log(`(chatPolling) - line form visitor:${ev.text}`);
                        //
                        if (ev.text === 'vert') {
                            this.sendData({
                                '@type': 'line',
                                'text': '[add line]',  // Ignored, but must presint
                                'textType': 'rich-content',  // use json, left text
                                'json': {
                                    'type': 'vertical',
                                    'elements': [
                                        {
                                            'type': 'text',
                                            'text': 'text here!',
                                        },
                                        {
                                            'type': 'button',
                                            'title': 'say img',
                                            'style': {
                                                'bold': true,
                                                'italic': false,
                                                'color': '#ffffff',
                                                'background-color': '#0000cc',
                                                'size': 'small',
                                            },
                                            'click': {
                                                'metadata': [{
                                                    'type': 'ExternalId',
                                                    'id': '12345',
                                                }],
                                                'actions': [{
                                                    'type': 'publishText',
                                                    'text': 'img',
                                                }],
                                            },
                                        },
                                    ],
                                },
                            });
                        } else if (ev.text === 'img') {
                            this.sendLine2('<div style="font-size: xx-large;">BIG</div><div style="font-size: xx-small;">SMALL</div><div style="color: #f00;font-weight: 900%;">color bold</div><div>img/link:<br><a href="http://www.google.com/"><img src="https://www.google.com/favicon.ico"></a><div>');
                        } else if (ev.text.substr(0, 3) === 'aws') {
                            var lex_text = ev.text.substr(3).trim();
                            console.log('LEX TEXT = ', lex_text);
                            params.inputText = lex_text;
                            lexruntime.postText(params, function(one) { return (err, data) => {
                                if (err) {
                                    console.log('AWS ERROR:', err, err.stack); // an error occurred
                                } else {
                                    console.log('AWS RESP:', JSON.stringify(data));           // successful response
                                    one.sendData(LexToLP(data));
                                }
                            }}(this));
                        } else {
                            var digit = parseInt(ev.text, 10);
                            if (isNaN(digit)) {
                                this.sendLine();
                            } else {
                                this.sendLine2(`${digit} + 1 = ${digit + 1}`)
                            }
                        }
                        //
                        //this.sendLine();
                    }
                }
            }
            this.chatTimer = setTimeout(() => {
                this.chatPolling(nextURL);
            }, this.chatPingInterval);
        });
    }

    sendLine() {
        const line = transcript[this.lineIndex];

        if (!line) {
            this.stop(err => {
                if (err) {
                    console.log(`Error stopping chat err: ${err.message}`);
                }
            });
            return;
        }


        console.log(`Sending line: ${line}`);
        const options = {
            method: 'POST',
            url: `${this.chatLink}/events.json?v=1&NC=true`,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true,
            body: {
                event: {
                    '@type': 'line',
                    'text': `<p dir='ltr' style='direction: ltr; text-align: left;'>${line}</p>`,
                    'textType': 'html'
                }
            }
        };

        setTimeout(() => {
            request(options, (error, response, body) => {
                this.lineIndex++;
                if (error) {
                    console.log(`Error sending line. Error: ${JSON.stringify(error)}`);
                }
                else if(response.statusCode < 200 || response.statusCode > 299){
                    console.log(`Error sending line. Body: ${JSON.stringify(body)}`);

                }
                console.log(`Send line: ${JSON.stringify(body)}`);
            });
        }, config.chat.minLineWaitTime);
    }

    sendData(data) {
        console.log(`Sending data: ${JSON.stringify(data)}`);
        const options = {
            method: 'POST',
            url: `${this.chatLink}/events.json?v=1&NC=true`,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true,
            body: {
                event: data,
            }
        };

        setTimeout(() => {
            request(options, (error, response, body) => {
                this.lineIndex++;
                if (error) {
                    console.log(`Error sending line. Error: ${JSON.stringify(error)}`);
                }
                else if(response.statusCode < 200 || response.statusCode > 299){
                    console.log(`Error sending line. Body: ${JSON.stringify(body)}`);

                }
                console.log(`Send line: ${JSON.stringify(body)}`);
            });
        }, config.chat.minLineWaitTime);
    }

    sendLine2(line) {
        console.log(`Sending line[2]: ${line}`);
        const options = {
            method: 'POST',
            url: `${this.chatLink}/events.json?v=1&NC=true`,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true,
            body: {
                event: {
                    '@type': 'line',
                    'text': `<p dir='ltr' style='direction: ltr; text-align: left;'>${line}</p>`,
                    'textType': 'html'
                }
            }
        };

        setTimeout(() => {
            request(options, (error, response, body) => {
                this.lineIndex++;
                if (error) {
                    console.log(`Error sending line. Error: ${JSON.stringify(error)}`);
                }
                else if(response.statusCode < 200 || response.statusCode > 299){
                    console.log(`Error sending line. Body: ${JSON.stringify(body)}`);

                }
                console.log(`Send line: ${JSON.stringify(body)}`);
            });
        }, config.chat.minLineWaitTime);
    }

    stop(callback) {
        clearTimeout(this.chatTimer);
        clearTimeout(this.incomingTimer);

        if (this.chatLink) {
            const options = {
                method: 'POST',
                url: `${this.chatLink}/events.json?v=1&NC=true`,
                headers: {
                    'Authorization': `Bearer ${this.session.getBearer()}`,
                    'content-type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                json: true,
                body: {
                    event: {
                        '@type': 'state',
                        'state': 'ended'
                    }
                }
            };
            request(options, (error, response, body) => {
                if (error) {
                    callback(`Error trying to end chat: ${JSON.stringify(error)}`);
                }
                else if(response.statusCode < 200 || response.statusCode > 299){
                    callback(`Error trying to end chat: ${JSON.stringify(body)}`);
                }
                this.session.stop(err => {
                    if (err) {
                        console.log(`Error stopping session: ${err.message}`);
                        callback(err);
                    }
                    else {
                       callback();
                    }
                });
            });
        }else{
            callback(`Chat link is unavailable chatLink: ${this.chatLink}`);
        }
    }

}

module.exports = AgentChat;
