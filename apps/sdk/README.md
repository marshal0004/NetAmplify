# NetAmplify NodeJS SDK

This is the NodeJS SDK for [NetAmplify](https://netamplify.com).

You can start by installing the package:

```bash
npm install @netamplify/node
```

## Usage
```typescript
import NetAmplify from '@netamplify/node';
const netamplify = new NetAmplify('your api key', 'your self-hosted instance (optional)');
```

The available methods are:
- `post(posts: CreatePostDto)` - Schedule a post to NetAmplify
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to NetAmplify
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

Alternatively you can use the SDK with curl, check the [NetAmplify API documentation](https://docs.netamplify.com/public-api) for more information.