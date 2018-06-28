Agent sample app
================

----

### Fork note

This fork is a proof-of-concept LivePerson-AWSLex integration

To run this code you have to setup environment:

```(sh)
export AWS_REGION='eu-west-1'
export AWS_ACCESS_KEY_ID='******************6A'
export AWS_SECRET_ACCESS_KEY='**************************************t+'

export LEX_BOT_ALIAS='$LATEST'
export LEX_BOT_NAME='GTCC'

export LP_ACCAUNT_ID=7******
export LP_USER='michurin_bot'
export LP_PASSWARD='******'
```

Related docs:
[overview](https://developers.liveperson.com/agent-add-lines.html),
[tempaltes and controls](https://developers.liveperson.com/structured-content-templates.html).

----

Agent simulator app.
This is a virtual agent simulator built over the Chat Agent API.
In this demo the simulator implements the following Chat Agent API endpoints:
 - LiveEngage login
 - LiveEngage session refresh
 - Set availability to online
 - Create agent session
 - Check for incoming chats
 - Accept chat invitation and start chat session (if there is a chat waiting in queue)
 - Chat polling (wait to get messages from visitor)
 - Send line
 - End the chat when the transcript is over

Prerequisites
=============
- Create LiveEngage site
- Ensure you have a user for this simulator (you will need a username and password)

Installation
============
- Run npm install 

Getting Started
===============
1. Run npm start
2. Enter account ID
3. Enter agent username
4. Enter agent password
5. Go to [visitor test page](https://livepersoninc.github.io/visitor-page/?siteid=SiteId), enter your site ID in the url and refresh the page 
6. Click to start chat
7. Send the first message from the visitor side 
8. Wait for the agent response
9. Follow steps 7 and 8 until the simulator ends the conversation
