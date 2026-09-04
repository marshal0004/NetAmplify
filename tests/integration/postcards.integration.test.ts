// /home/z/my-project/netamplify-app/tests/integration/postcards.integration.test.ts
// NetAmplify — Integration tests for /api/postcards/* endpoints.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app';

describe('Integration: PostCards', () => {
  let test: TestApp;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    test = await createTestApp();
    const auth = await test.signupAndLogin();
    token = auth.accessToken;
    userId = auth.userId;
  });

  afterEach(async () => {
    await test.close();
  });

  describe('POST /api/postcards', () => {
    it('returns 201 + PostCard on valid input', async () => {
      const res = await test.request.post('/api/postcards')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'My Project',
          summary: 'A summary',
          description: 'A longer description',
          techStack: ['TypeScript', 'React'],
          repoUrl: 'https://github.com/user/repo',
          liveUrl: 'https://example.com',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.title).toBe('My Project');
      expect(res.body.summary).toBe('A summary');
      expect(res.body.techStack).toEqual(['TypeScript', 'React']);
      expect(res.body.repoUrl).toBe('https://github.com/user/repo');
    });

    it('returns 400 on missing title', async () => {
      const res = await test.request.post('/api/postcards')
        .set('Authorization', `Bearer ${token}`)
        .send({ summary: 'S', description: 'D', techStack: ['a'] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 on empty techStack', async () => {
      const res = await test.request.post('/api/postcards')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'T', summary: 'S', description: 'D', techStack: [] });
      expect(res.status).toBe(400);
    });

    it('returns 400 on >10 techStack tags', async () => {
      const res = await test.request.post('/api/postcards')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'T', summary: 'S', description: 'D',
          techStack: Array(11).fill('tag'),
        });
      expect(res.status).toBe(400);
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.post('/api/postcards').send({
        title: 'T', summary: 'S', description: 'D', techStack: ['a'],
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/postcards', () => {
    it('returns paginated list of user\'s PostCards', async () => {
      // Create 3 PostCards
      for (let i = 0; i < 3; i++) {
        await test.request.post('/api/postcards')
          .set('Authorization', `Bearer ${token}`)
          .send({
            title: `Project ${i}`,
            summary: `Summary ${i}`,
            description: 'D',
            techStack: ['a'],
          });
      }
      const res = await test.request.get('/api/postcards?page=1&pageSize=10')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(3);
      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
    });

    it('returns empty list for new user', async () => {
      const res = await test.request.get('/api/postcards')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(0);
      expect(res.body.total).toBe(0);
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.get('/api/postcards');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/postcards/:id', () => {
    it('returns 200 for owner', async () => {
      const created = await test.createPostCard(token, { title: 'X' });
      const res = await test.request.get(`/api/postcards/${created.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.id);
      expect(res.body.title).toBe('X');
    });

    it('returns 404 for non-existent PostCard', async () => {
      const res = await test.request.get('/api/postcards/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for another user\'s PostCard (no enumeration)', async () => {
      // Create a PostCard as user-1
      const card = await test.createPostCard(token, {});
      // Signup user-2
      const auth2 = await test.signupAndLogin();
      // Try to access user-1's PostCard as user-2
      const res = await test.request.get(`/api/postcards/${card.id}`)
        .set('Authorization', `Bearer ${auth2.accessToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/postcards/:id', () => {
    it('updates title only (partial update)', async () => {
      const card = await test.createPostCard(token, { title: 'Old' });
      const res = await test.request.patch(`/api/postcards/${card.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'New' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('New');
    });

    it('returns 404 for non-existent PostCard', async () => {
      const res = await test.request.patch('/api/postcards/nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/postcards/:id', () => {
    it('returns 204 for owner', async () => {
      const card = await test.createPostCard(token, {});
      const res = await test.request.delete(`/api/postcards/${card.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);

      // Subsequent GET returns 404
      const after = await test.request.get(`/api/postcards/${card.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await test.request.delete('/api/postcards/nonexistent')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/postcards/:id/preview', () => {
    it('returns Format Engine output for REDDIT', async () => {
      const card = await test.createPostCard(token, {
        title: 'My Project',
        description: 'A description',
      });
      const res = await test.request.get(`/api/postcards/${card.id}/preview?platform=REDDIT&subreddit=test`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.platform).toBe('REDDIT');
      expect(res.body.formatted.title).toBe('My Project');
      expect(res.body.formatted.body).toContain('A description');
      expect(res.body.formatted.charCount).toBeGreaterThan(0);
    });

    it('returns 200 for each platform', async () => {
      const card = await test.createPostCard(token, {});
      const platforms = ['REDDIT', 'TWITTER', 'LINKEDIN', 'DISCORD', 'DEVTO', 'HASHNODE', 'TELEGRAM', 'BLUESKY'];
      for (const p of platforms) {
        const res = await test.request.get(`/api/postcards/${card.id}/preview?platform=${p}`)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status, `platform=${p}`).toBe(200);
        expect(res.body.platform).toBe(p);
        expect(res.body.formatted.body).toBeTruthy();
      }
    });

    it('returns 400 for unknown platform', async () => {
      const card = await test.createPostCard(token, {});
      const res = await test.request.get(`/api/postcards/${card.id}/preview?platform=INSTAGRAM`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent PostCard', async () => {
      const res = await test.request.get('/api/postcards/nonexistent/preview?platform=REDDIT')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });
});
