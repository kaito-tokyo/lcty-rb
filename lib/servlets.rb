# encoding: utf-8
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

require 'webrick'

module Lcty; end

module Lcty::Servlets
  MIME_TYPES = WEBrick::HTTPUtils::DefaultMimeTypes.merge(
    'html' => 'text/html; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'mjs' => 'text/javascript; charset=utf-8',
    'cjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'svg' => 'image/svg+xml'
  ).freeze

  # One file, path_from_pwd (relative to the working directory, which the server is started in), with its type from
  # MIME_TYPES, Cache-Control, Last-Modified and an ETag; If-None-Match that matches is answered 304. HEAD answers the
  # headers GET would.
  class StaticFileServlet < WEBrick::HTTPServlet::AbstractServlet
    def initialize(server, path_from_pwd, cache_control = 'no-cache')
      raise ArgumentError, 'path_from_pwd must be provided' unless path_from_pwd
      raise ArgumentError, 'cache_control must be a String' unless cache_control.is_a?(String)
      super(server)
      @path_from_pwd = path_from_pwd
      @content_type = WEBrick::HTTPUtils.mime_type(@path_from_pwd, MIME_TYPES)
      @cache_control = cache_control
    end

    def get_etag(file_stat)
      %("#{file_stat.size.to_s(16)}-#{file_stat.mtime.to_i.to_s(16)}")
    end

    def do_GET(req, res)
      raise WEBrick::HTTPStatus::NotFound unless File.file?(@path_from_pwd)

      file_stat = File.stat(@path_from_pwd)
      res['Cache-Control'] = @cache_control
      res['Last-Modified'] = file_stat.mtime.httpdate
      res['ETag'] = get_etag(file_stat)
      raise WEBrick::HTTPStatus::NotModified if req['If-None-Match'].to_s.split(/\s*,\s*/).include?(res['ETag'])

      res.content_type = @content_type
      res.body = File.binread(@path_from_pwd)
    end
  end

  REDIRECT_MAX_AGE = 86_400 # seconds a browser keeps a redirect to /lcty.v1/: a day

  # A directory of the site that holds pages: the page index_path_from_pwd at the directory itself (and index.html), the
  # data files of data_dir that data_file? accepts, and, for a name of the directory's own that starts with lcty.v1 (the
  # files conversation files and tag files load next to themselves, by names they keep on disk), a redirect to the same
  # name in /lcty.v1/, kept by the browser for REDIRECT_MAX_AGE. The directory without its slash is redirected to it
  # with its query, so that the pages' relative paths resolve; every Location is relative, so the site may be under any
  # path. Everything else is 404. The files are served by StaticFileServlet (no-cache, with an ETag).
  class PageDirectoryServlet < WEBrick::HTTPServlet::AbstractServlet
    def initialize(server, data_dir, index_path_from_pwd)
      raise ArgumentError, 'data_dir must be provided' unless data_dir
      super(server)
      @data_dir = data_dir
      @index_path_from_pwd = index_path_from_pwd
    end

    def do_GET(req, res)
      if req.path_info.to_s.empty? # /c: the relative Location c/ (the last part of the mount point)
        dir = "#{File.basename(req.script_name)}/"
        res.set_redirect(WEBrick::HTTPStatus::Found, req.query_string.to_s.empty? ? dir : "#{dir}?#{req.query_string}")
      end
      name = String.new(req.path_info.delete_prefix('/'), encoding: Encoding::UTF_8)
      raise WEBrick::HTTPStatus::NotFound unless name.valid_encoding?
      return serve(@index_path_from_pwd, req, res) if name.empty? || name == 'index.html'

      if name.start_with?('lcty.v1') && !name.include?('/')
        res['Cache-Control'] = "max-age=#{REDIRECT_MAX_AGE}"
        # Escaped, so a name with a space, a ? or a character outside ASCII stays one path (escape_path takes a path
        # that starts with /)
        res.set_redirect(WEBrick::HTTPStatus::Found, "../lcty.v1#{WEBrick::HTTPUtils.escape_path("/#{name}")}")
      end
      raise WEBrick::HTTPStatus::NotFound unless data_file?(name)

      serve(File.join(@data_dir, name), req, res)
    end

    private

    # Whether name (no slash: the directory's own files only) is a data file of this directory
    def data_file?(_name)
      false
    end

    def serve(path, req, res)
      StaticFileServlet.new(@server, path).do_GET(req, res)
    end
  end

  # /c/: the new conversation page (public/c/index.html) and the conversation files of conv_dir, /c/<id>.html
  # (LCTYSP-0003, LCTYSP-0005). Mounted as mount("…c", C, conv_dir).
  class C < PageDirectoryServlet
    ID_RE = /\A[A-Za-z0-9_-]{1,80}\z/.freeze # a conversation's id (as lib/config.rb)

    def initialize(server, conv_dir)
      super(server, conv_dir, 'public/c/index.html')
    end

    private

    def data_file?(name)
      id = name[/\A(.+)\.html\z/, 1]
      !id.nil? && ID_RE.match?(id)
    end
  end

  # /t/: the tag reorder page (public/t/index.html) and the tag files of tag_dir, /t/NNNNN-<part>.html (LCTYSP-0009).
  # Mounted as mount("…t", T, tag_dir).
  class T < PageDirectoryServlet
    TAG_FILE_RE = /\A[0-9]{5}-.+\.html\z/m.freeze # a tag file's name (as lib/tag_files.rb)
    MAX_FILE_BYTES = 255

    def initialize(server, tag_dir)
      super(server, tag_dir, 'public/t/index.html')
    end

    private

    def data_file?(name)
      name.bytesize <= MAX_FILE_BYTES && !name.match?(%r{[/\\:\u0000]}) && TAG_FILE_RE.match?(name)
    end
  end

  # The files of a directory, dir_from_pwd, at the paths below the mount point (for /js/…, the workers at the root, …);
  # the directory itself is its index.html. A path with an empty part, a part starting with "." (.., .git, dot files)
  # or a NUL never reaches the disk, and a directory is 404. The files are served by StaticFileServlet.
  class PublicDirectoryServlet < WEBrick::HTTPServlet::AbstractServlet
    def initialize(server, dir_from_pwd)
      raise ArgumentError, 'dir_from_pwd must be provided' unless dir_from_pwd
      super(server)
      @dir_from_pwd = dir_from_pwd
    end

    def do_GET(req, res)
      rel = String.new(req.path_info.to_s.delete_prefix('/'), encoding: Encoding::UTF_8)
      raise WEBrick::HTTPStatus::NotFound unless rel.valid_encoding?
      rel = 'index.html' if rel.empty?
      parts = rel.split('/', -1)
      raise WEBrick::HTTPStatus::NotFound if parts.any? { |p| p.empty? || p.start_with?('.') || p.include?("\0") }

      StaticFileServlet.new(@server, File.join(@dir_from_pwd, *parts)).do_GET(req, res)
    end
  end
end
