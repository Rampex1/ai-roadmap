import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { filterSidebar, flattenLinks } from '@/lib/sidebar';

// Filter the sidebar to the current course and recompute prev/next from the filtered list,
// so pagination never jumps into another course.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  route.sidebar = filterSidebar(route.sidebar, context.url.pathname);
  const links = flattenLinks(route.sidebar as any[]);
  const i = links.findIndex((l: any) => l.isCurrent);
  if (i >= 0) {
    route.pagination = {
      prev: route.pagination.prev && links[i - 1] ? (links[i - 1] as any) : undefined,
      next: route.pagination.next && links[i + 1] ? (links[i + 1] as any) : undefined,
    };
  }
});
